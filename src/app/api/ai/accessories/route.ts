import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chatWithGemini } from "@/lib/ai/gemini";
import { getProductCatalogContext } from "@/lib/ai/context";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("productId");

    if (!productId) {
      return NextResponse.json({ error: "productId is required" }, { status: 400 });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { category: true },
    });

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

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

    // Parse AI response and find matching products
    let suggestions: { name: string; reason: string }[] = [];
    try {
      const cleaned = response.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      suggestions = JSON.parse(cleaned);
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
            isActive: true,
            id: { not: productId },
            OR: prefixes.map((p) => ({ name: { contains: p, mode: "insensitive" as const } })),
          },
          include: { category: true },
          take: 100,
        })
      : [];

    // Зворотний бік звірки (назва товару входить у пропозицію АІ) на коротких
    // назвах давав хибні влучення: у каталозі є товар з назвою «С», і він
    // підходив під будь-яку пропозицію, витісняючи правильний товар. Тому
    // зворотну перевірку робимо лише для назв, довших за 4 символи.
    const matched = suggestions
      .map((s) => {
        const needle = s.name.toLowerCase();
        const found = candidates.find((p) => {
          const name = p.name.toLowerCase();
          if (name.includes(needle.slice(0, 20))) return true;
          return name.length > 4 && needle.includes(name.slice(0, 20));
        });
        return found ? { ...found, reason: s.reason } : null;
      })
      .filter(Boolean);

    // Якщо АІ не влучив у каталог — показуємо товари з ІНШИХ категорій
    // (саме так поводився старий код: фільтр був `!==`, не `===`).
    if (matched.length === 0) {
      const fallback = await prisma.product.findMany({
        where: {
          isActive: true,
          id: { not: productId },
          categoryId: { not: product.categoryId },
        },
        include: { category: true },
        take: 4,
      });
      return NextResponse.json({
        product: { id: product.id, name: product.name },
        accessories: fallback,
        type: "category_fallback",
      });
    }

    return NextResponse.json({
      product: { id: product.id, name: product.name },
      accessories: matched,
      type: "ai_matched",
    });
  } catch (error: unknown) {
    console.error("AI Accessories error:", error);
    return NextResponse.json({ error: "Помилка підбору аксесуарів" }, { status: 500 });
  }
}
