import { NextResponse } from "next/server";
import { chatWithGemini } from "@/lib/ai/gemini";
import { getProductCatalogContext, getSystemPrompt, searchProductsForAI } from "@/lib/ai/context";
import { prisma } from "@/lib/prisma";

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

interface ProductComparison {
  name: string;
  pros: string[];
  cons: string[];
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

function extractComparison(response: string): { cleanResponse: string; comparison: ProductComparison[] } {
  const match = response.match(/```comparison\s*\n([\s\S]*?)```/);
  if (!match) return { cleanResponse: response, comparison: [] };

  let comparison: ProductComparison[] = [];
  try {
    comparison = JSON.parse(match[1]);
  } catch {
    // If JSON parsing fails, try to extract manually
    comparison = [];
  }

  const cleanResponse = response.replace(/```comparison\s*\n[\s\S]*?```/, "").trim();
  return { cleanResponse, comparison };
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

    // Build search query — use fewer, more focused keywords
    const searchParts: string[] = [];

    // Category-based keywords — reduced to main tool types only (not consumables)
    const categoryKeywords: Record<string, string> = {
      "Свердління / Перфорація": "дриль перфоратор",
      "Різання / Розпил": "болгарка пила лобзик",
      "Шліфування / Полірування": "шліфмашина полірувальна",
      "Вимірювання / Розмітка": "рівень лазерний далекомір",
      "Зварювання / Паяння": "зварювальний інвертор паяльник",
      "Фарбування / Оздоблення": "фарбопульт краскопульт",
      "Ручний інструмент": "набір ключ викрутка плоскогубці",
    };
    searchParts.push(categoryKeywords[category] || category);

    // Material keywords — only add specific tool-type hints, not generic materials
    if (material) {
      const materialKeywords: Record<string, string> = {
        "Бетон / Цегла / Камінь": "перфоратор SDS",
        "Дерево / Фанера / ДСП": "дерево",
        "Метал": "метал",
        "Метал / Профіль / Труби": "метал",
        "Бетон / Камінь / Плитка": "бетон алмазний",
        "Гіпсокартон / Сухі суміші": "шуруповерт",
      };
      searchParts.push(materialKeywords[material] || material);
    }

    // Power source
    if (powerSource && powerSource !== "Не має значення") {
      if (powerSource.includes("Акумулятор")) searchParts.push("акумуляторний");
      if (powerSource.includes("Мережевий")) searchParts.push("мережевий 220");
    }

    // Brand
    if (brand && brand !== "Без переваг — покажіть найкращі") {
      searchParts.push(brand);
    }

    // Build a natural language query for semantic search (better intent understanding)
    const naturalQuery = [
      category,
      material ? `для ${material}` : "",
      powerSource && powerSource !== "Не має значення" ? powerSource : "",
      brand && brand !== "Без переваг — покажіть найкращі" ? `бренд ${brand}` : "",
      specificTask || "",
    ].filter(Boolean).join(", ");

    // Budget goes into price filter via extractPriceRange, not as keywords
    const searchQuery = `${searchParts.join(" ")} ${budget}`;

    // Search with both keyword query AND natural language query for semantic search
    const [catalog, searchResults] = await Promise.all([
      getProductCatalogContext(),
      searchProductsForAI(`${searchQuery} | ${naturalQuery}`),
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

    // Add strict filtering hints for the AI
    const filterHints: string[] = [];
    if (powerSource && powerSource !== "Не має значення") {
      if (powerSource.includes("Мережевий")) {
        filterHints.push("ФІЛЬТР: Рекомендуй ТІЛЬКИ мережеві інструменти (220В, з кабелем). НЕ рекомендуй акумуляторні інструменти.");
      } else if (powerSource.includes("Акумулятор")) {
        filterHints.push("ФІЛЬТР: Рекомендуй ТІЛЬКИ акумуляторні інструменти. НЕ рекомендуй мережеві (220В).");
      }
    }
    filterHints.push("ФІЛЬТР: Рекомендуй ТІЛЬКИ інструменти (електро/ручні), а НЕ витратні матеріали, свердла, бури, диски, насадки.");

    const userMessage = `Підбери мені інструмент за наступними критеріями:

${details.join("\n")}

${filterHints.join("\n")}

ВАЖЛИВО: Рекомендуй ТІЛЬКИ товари з розділу РЕЗУЛЬТАТИ ПОШУКУ вище. Використовуй точні назви та ціни.
Покажи ТОП 3-5 товарів що найкраще підходять під ці критерії. Поясни чому кожен підходить.
Дай фінальну рекомендацію — який один товар найкращий вибір і чому.
Якщо серед результатів немає товарів що відповідають УСІМ критеріям — чесно скажи і покажи найближчі альтернативи.`;

    const rawResponse = await chatWithGemini(
      [{ role: "user", parts: [{ text: userMessage }] }],
      systemPrompt
    );

    // Extract comparison block first
    const { cleanResponse: withoutComparison, comparison } = extractComparison(rawResponse);
    // Then extract product names
    const { cleanResponse, productNames } = extractProductNames(withoutComparison);

    let products: any[] = [];

    if (productNames.length > 0) {
      // Build flexible search: split each name into significant words
      const searchConditions = productNames.flatMap((name) => {
        const conditions = [
          { name: { contains: name.slice(0, 30), mode: "insensitive" as const } },
        ];
        // Also search by significant words (3+ chars) from the name
        const words = name.split(/[\s,\-\/]+/).filter((w) => w.length >= 3);
        if (words.length >= 2) {
          // Search by first 2-3 significant words combined
          for (const word of words.slice(0, 3)) {
            conditions.push({ name: { contains: word, mode: "insensitive" as const } });
          }
        }
        return conditions;
      });

      // Prefer in-stock products; fetch separately and merge
      const [inStockProducts, allStockProducts] = await Promise.all([
        prisma.product.findMany({
          where: {
            isActive: true,
            stock: { gt: 0 },
            OR: searchConditions,
          },
          include: { category: true },
          take: 40,
        }),
        prisma.product.findMany({
          where: {
            isActive: true,
            OR: searchConditions,
          },
          include: { category: true },
          take: 50,
        }),
      ]);

      // Merge: in-stock first, then fill with out-of-stock (deduped)
      const seenIds = new Set(inStockProducts.map((p) => p.id));
      const outOfStock = allStockProducts.filter((p) => !seenIds.has(p.id)).slice(0, 10);
      const allProducts = [...inStockProducts, ...outOfStock];

      // Smart matching: find best match for each AI-recommended name
      const usedIds = new Set<string>();
      products = productNames
        .map((name) => {
          const nameLower = name.toLowerCase().trim();
          const nameWords = nameLower.split(/[\s,\-\/]+/).filter((w) => w.length >= 3);

          // Score each product against this name
          let bestMatch: typeof allProducts[0] | null = null;
          let bestScore = 0;

          for (const p of allProducts) {
            if (usedIds.has(p.id)) continue;
            const pLower = p.name.toLowerCase();

            // Exact match
            if (pLower === nameLower) { bestMatch = p; bestScore = 100; break; }

            let score = 0;
            // Full name contains
            if (pLower.includes(nameLower)) score += 50;
            if (nameLower.includes(pLower)) score += 40;

            // Word-level matching
            for (const word of nameWords) {
              if (pLower.includes(word)) score += 10;
            }

            // Product name words in search name
            const pWords = pLower.split(/[\s,\-\/]+/).filter((w) => w.length >= 3);
            for (const word of pWords) {
              if (nameLower.includes(word)) score += 5;
            }

            if (score > bestScore) {
              bestScore = score;
              bestMatch = p;
            }
          }

          if (bestMatch && bestScore >= 20) {
            usedIds.add(bestMatch.id);
            return bestMatch;
          }
          return null;
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

    // Match comparison pros/cons to matched products
    const productsWithComparison = products.map((p: any) => {
      const comp = comparison.find((c) => {
        const cLower = c.name.toLowerCase();
        const pLower = p.name.toLowerCase();
        return pLower === cLower || pLower.includes(cLower) || cLower.includes(pLower.slice(0, 25));
      });
      return {
        ...p,
        pros: comp?.pros || [],
        cons: comp?.cons || [],
      };
    });

    return NextResponse.json({ response: cleanResponse, products: productsWithComparison });
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
