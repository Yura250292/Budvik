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
    const body = await req.json();
    const {
      toolCategory,
      material,
      specificTask,
      frequency,
      powerSource,
      brand,
      budget,
      additionalFeatures,
      // Legacy support
      taskType,
    } = body;

    const category = toolCategory || taskType;
    if (!category || !budget) {
      return NextResponse.json(
        { error: "Недостатньо даних для підбору" },
        { status: 400 }
      );
    }

    // Build search query from all parameters
    const searchParts: string[] = [];

    // Category-based keywords
    const categoryKeywords: Record<string, string> = {
      "Свердління / Перфорація": "дриль перфоратор шуруповерт свердло",
      "Різання / Розпил": "болгарка пила лобзик різак ножівка",
      "Шліфування / Полірування": "шліфмашина полірувальна шліфувальна наждак",
      "Вимірювання / Розмітка": "рівень рулетка лазерний далекомір кутомір",
      "Зварювання / Паяння": "зварювальний інвертор паяльник зварка",
      "Фарбування / Оздоблення": "фарбопульт краскопульт шпатель валик",
      "Ручний інструмент": "набір ключ викрутка плоскогубці молоток",
    };
    searchParts.push(categoryKeywords[category] || category);

    // Material keywords
    if (material) {
      const materialKeywords: Record<string, string> = {
        "Бетон / Цегла / Камінь": "бетон перфоратор бур SDS",
        "Дерево / Фанера / ДСП": "дерево фанера",
        "Метал": "метал",
        "Метал / Профіль / Труби": "метал труба профіль",
        "Бетон / Камінь / Плитка": "бетон плитка камінь алмазний",
        "Гіпсокартон / Сухі суміші": "гіпсокартон шуруповерт",
      };
      searchParts.push(materialKeywords[material] || material);
    }

    // Power source
    if (powerSource && powerSource !== "Не має значення") {
      if (powerSource.includes("Акумулятор")) searchParts.push("акумуляторний");
      if (powerSource.includes("Мережевий")) searchParts.push("мережевий");
    }

    // Brand
    if (brand && brand !== "Без переваг — покажіть найкращі") {
      searchParts.push(brand);
    }

    const searchQuery = `${searchParts.join(" ")} ${budget}`;

    const [catalog, searchResults] = await Promise.all([
      getProductCatalogContext(),
      searchProductsForAI(searchQuery),
    ]);

    const systemPrompt = getSystemPrompt("wizard") + "\n\n" + catalog + searchResults;

    // Build detailed user message
    const details: string[] = [];
    details.push(`Категорія інструменту: ${category}`);
    if (material) details.push(`Матеріал: ${material}`);
    if (specificTask) details.push(`Конкретна задача: ${specificTask}`);
    if (frequency) details.push(`Частота використання: ${frequency}`);
    if (powerSource) details.push(`Тип живлення: ${powerSource}`);
    if (brand) details.push(`Бренд: ${brand}`);
    details.push(`Бюджет: ${budget}`);
    if (additionalFeatures) details.push(`Додаткові вимоги: ${additionalFeatures}`);

    const userMessage = `Підбери мені інструмент за наступними критеріями:

${details.join("\n")}

ВАЖЛИВО: Рекомендуй ТІЛЬКИ товари з розділу РЕЗУЛЬТАТИ ПОШУКУ вище. Використовуй точні назви та ціни.
Покажи ТОП 3-5 товарів що найкраще підходять під ці критерії. Поясни чому кожен підходить.
Дай фінальну рекомендацію — який один товар найкращий вибір і чому.`;

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
