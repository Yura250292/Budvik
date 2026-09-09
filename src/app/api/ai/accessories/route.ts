import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { chatWithGemini } from "@/lib/ai/gemini";
import { getProductCatalogContext } from "@/lib/ai/context";
import { showableProductWhere } from "@/lib/catalog/showable";
import { RECO_SELECT } from "@/lib/catalog/related";

/**
 * Сумісні аксесуари та витратні матеріали до товару.
 *
 * Підбирає Gemini з контексту каталогу, далі пропозиції звіряються з базою —
 * показуємо лише те, що справді є в продажу.
 *
 * **Кеш обовʼязковий.** До 09.09.2026 виклик ішов на КОЖЕН показ картки: живий
 * запит до платного API плюс контекст каталогу на кожного відвідувача кожного
 * з 6 486 товарів. Тепер відповідь живе добу на товар, тож ціна питання —
 * один виклик на товар, а не на перегляд.
 */
const suggestAccessories = unstable_cache(
  async (productId: string) => {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { category: true },
    });
    if (!product) return null;

    const catalog = await getProductCatalogContext();

    const response = await chatWithGemini(
      [
        {
          role: "user",
          parts: [
            {
              text: `Для товару "${product.name}" (${product.category.name}) підбери сумісні аксесуари та витратні матеріали з каталогу.

Якщо в каталозі немає прямих аксесуарів, запропонуй супутні товари які часто купують разом з цим інструментом.

Відповідай у форматі JSON масиву з полями:
- "name": назва товару з каталогу
- "reason": чому цей товар підходить як аксесуар

Приклад: [{"name": "Товар 1", "reason": "причина"}, ...]

ТІЛЬКИ JSON, без пояснень.`,
            },
          ],
        },
      ],
      `Ти — система підбору аксесуарів для інструментів. Відповідай ТІЛЬКИ валідним JSON.\n\n${catalog}`
    );

    let suggestions: { name: string; reason: string }[] = [];
    try {
      const cleaned = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) suggestions = parsed;
    } catch {
      suggestions = [];
    }

    // Зіставляємо пропозиції АІ з реальним каталогом.
    //
    // Раніше тут був findMany БЕЗ обмежень — усі ~49 тис. активних товарів з
    // приєднаною категорією тягнулися в пам'ять заради лінійного .find() по
    // кількох назвах. Заміряно: 12 224 мс на публічній сторінці товару.
    // Тепер шукаємо в базі тільки те, що запропонував АІ.
    //
    // Префікс у 20 символів — та сама евристика, що була в .find(): АІ часто
    // вертає назву з іншим хвостом («…, 750 Вт»), тож звіряємо початок.
    const prefixes = suggestions
      .map((s) => s.name?.trim().slice(0, 20))
      .filter((n): n is string => !!n);

    const candidates = prefixes.length
      ? await prisma.product.findMany({
          where: {
            ...showableProductWhere(),
            id: { not: productId },
            OR: prefixes.map((p) => ({ name: { contains: p, mode: "insensitive" as const } })),
          },
          select: RECO_SELECT,
          take: 100,
        })
      : [];

    // Зворотний бік звірки (назва товару входить у пропозицію АІ) на коротких
    // назвах давав хибні влучення: у каталозі є товар з назвою «С», і він
    // підходив під будь-яку пропозицію, витісняючи правильний товар. Тому
    // зворотну перевірку робимо лише для назв, довших за 4 символи.
    const seen = new Set<string>();
    const matched = suggestions
      .map((s) => {
        const needle = (s.name ?? "").toLowerCase();
        if (!needle) return null;
        const found = candidates.find((p) => {
          const name = p.name.toLowerCase();
          if (name.includes(needle.slice(0, 20))) return true;
          return name.length > 4 && needle.includes(name.slice(0, 20));
        });
        if (!found || seen.has(found.id)) return null;
        seen.add(found.id);
        return { ...found, reason: s.reason };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // Не влучили в каталог — віддаємо порожньо, і блок ховається.
    //
    // Тут стояв запасний шлях «чотири товари з ІНШИХ категорій»: під
    // заголовком «Сумісні аксесуари» покупцеві показували випадкові позиції.
    // Це та сама хвороба, через яку «Часто купують разом» радив автомобільні
    // компресори до туристичної ложки. Краще нічого, ніж навмання.
    return { product: { id: product.id, name: product.name }, accessories: matched };
  },
  ["ai-accessories"],
  { revalidate: 86_400, tags: ["ai-accessories"] }
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("productId");

    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }

    const result = await suggestAccessories(productId);
    if (!result) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    return NextResponse.json({ ...result, type: "ai_matched" });
  } catch (error: unknown) {
    // Пишемо саму помилку в лог: коли Google зняв модель, у консолі браузера
    // було лише «500», і вісім місць системи лежали мовчки три тижні.
    console.error("AI Accessories error:", error instanceof Error ? error.message : error);
    // Порожній список, а не 500: блок просто не показується, а картка товару
    // лишається цілою. Червона помилка в консолі на кожній картці нічого
    // покупцеві не давала.
    return NextResponse.json({ accessories: [], type: "unavailable" });
  }
}
