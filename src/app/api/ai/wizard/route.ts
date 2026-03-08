import { NextResponse } from "next/server";
import { chatWithGemini } from "@/lib/ai/gemini";
import { getProductCatalogContext, getSystemPrompt, searchProductsForAI } from "@/lib/ai/context";
import { prisma } from "@/lib/prisma";

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

function extractProductNames(response: string): { cleanResponse: string; productNames: string[] } {
  const match = response.match(/```products\s*\n([\s\S]*?)```/);
  if (!match) return { cleanResponse: response, productNames: [] };

  const productNames = match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const cleanResponse = response.replace(/```products\s*\n[\s\S]*?```/, "").trim();
  return { cleanResponse, productNames };
}

export async function POST(req: Request) {
  try {
    const { taskType, frequency, budget } = await req.json();

    if (!taskType || !frequency || !budget) {
      return NextResponse.json(
        { error: "taskType, frequency, and budget are required" },
        { status: 400 }
      );
    }

    const taskKeywords: Record<string, string> = {
      "Бетон / Цегла / Камінь": "перфоратор дриль бур зубило коронка долото бетон",
      "Дерево / Фанера / ДСП": "пила лобзик фрезер шліфмашина дриль свердло дерево",
      "Метал / Профіль / Труби": "болгарка різак зварювання дриль свердло метал труборіз",
      "Плитка / Кераміка": "плиткоріз болгарка коронка алмазний диск плитка",
      "Гіпсокартон / Сухі суміші": "шуруповерт міксер рубанок різак гіпсокартон",
      "Фарбування / Оздоблення": "фарбопульт валик шпатель шліфмашина фарба",
      "Вимірювання / Розмітка": "рівень рулетка лазерний далекомір кутомір",
      "Універсальне використання": "дриль шуруповерт болгарка набір інструмент",
    };
    const searchTerms = taskKeywords[taskType] || taskType;
    const searchQuery = `${searchTerms} ${budget}`;

    const [catalog, searchResults] = await Promise.all([
      getProductCatalogContext(),
      searchProductsForAI(searchQuery),
    ]);

    const systemPrompt = getSystemPrompt("wizard") + "\n\n" + catalog + searchResults;

    const userMessage = `Підбери мені інструменти для наступних потреб:

Тип роботи: ${taskType}
Частота використання: ${frequency}
Бюджет: ${budget}

ВАЖЛИВО: Рекомендуй ТІЛЬКИ товари з розділу РЕЗУЛЬТАТИ ПОШУКУ вище. Використовуй точні назви та ціни з результатів.
Покажи ТОП 3-5 товарів, порівняй їх та дай фінальну рекомендацію.`;

    const rawResponse = await chatWithGemini(
      [{ role: "user", parts: [{ text: userMessage }] }],
      systemPrompt
    );

    const { cleanResponse, productNames } = extractProductNames(rawResponse);

    let products: any[] = [];

    if (productNames.length > 0) {
      const allProducts = await prisma.product.findMany({
        where: {
          isActive: true,
          OR: productNames.map((name) => ({
            name: { contains: name.slice(0, 30), mode: "insensitive" as const },
          })),
        },
        include: { category: true },
        take: 20,
      });

      products = productNames
        .map((name) => {
          const nameLower = name.toLowerCase();
          return allProducts.find((p) => {
            const pLower = p.name.toLowerCase();
            return pLower === nameLower || pLower.includes(nameLower) || nameLower.includes(pLower.slice(0, 30));
          });
        })
        .filter(Boolean)
        .map((p: any) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          description: stripHtml(p.description || "").slice(0, 300),
          price: p.price,
          image: p.image,
          stock: p.stock,
          isPromo: p.isPromo,
          promoPrice: p.promoPrice,
          promoLabel: p.promoLabel,
          category: { name: p.category.name, slug: p.category.slug },
        }));
    }

    return NextResponse.json({ response: cleanResponse, products });
  } catch (error: unknown) {
    console.error("AI Wizard error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    const isRateLimit = msg.includes("перевантажений") || msg.includes("429");
    return NextResponse.json(
      {
        error: isRateLimit
          ? "AI сервіс тимчасово перевантажений. Спробуйте через хвилину."
          : "Помилка AI сервісу",
      },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}
