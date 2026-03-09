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
    comparison = [];
  }

  const cleanResponse = response.replace(/```comparison\s*\n[\s\S]*?```/, "").trim();
  return { cleanResponse, comparison };
}

// Map wizard selections to specific, targeted search queries
// Returns: { primary: string, categoryFilter: string[] }
function buildSmartQuery(
  category: string,
  material?: string,
  powerSource?: string,
  brand?: string,
  budget?: string,
): { primary: string; categoryNames: string[] } {
  // Map category+material to specific tool search terms and DB category names
  const toolMap: Record<string, Record<string, { query: string; categories: string[] }>> = {
    "Свердління / Перфорація": {
      "Бетон / Цегла / Камінь": {
        query: "перфоратор",
        categories: ["Перфоратори", "Прямі перфоратори", "Бочкові перфоратори", "Акумуляторні перфоратори"],
      },
      "Дерево / Фанера / ДСП": {
        query: "дриль шуруповерт",
        categories: ["Дрилі", "Акумуляторні шуруповерти", "Шуруповерти"],
      },
      "Метал": {
        query: "дриль ударна",
        categories: ["Дрилі", "Ударні дрилі"],
      },
      "Гіпсокартон / Сухі суміші": {
        query: "шуруповерт",
        categories: ["Акумуляторні шуруповерти", "Шуруповерти"],
      },
      "_default": {
        query: "дриль перфоратор шуруповерт",
        categories: ["Дрилі", "Ударні дрилі", "Перфоратори", "Акумуляторні шуруповерти"],
      },
    },
    "Різання / Розпил": {
      "Дерево / Фанера / ДСП": {
        query: "пила лобзик циркулярна",
        categories: ["Циркулярні пили", "Електролобзики", "Електропили", "Акумуляторні циркулярні пили", "Акумуляторні лобзики", "Акумуляторні ланцюгові пилки"],
      },
      "Метал / Профіль / Труби": {
        query: "болгарка кшм кутова шліфмашина",
        categories: ["Кутові шліфмашини (Болгарки)", "Акумуляторні болгарки (КШМ)"],
      },
      "Бетон / Камінь / Плитка": {
        query: "болгарка кшм різак",
        categories: ["Кутові шліфмашини (Болгарки)", "Акумуляторні болгарки (КШМ)"],
      },
      "_default": {
        query: "болгарка пила лобзик",
        categories: ["Кутові шліфмашини (Болгарки)", "Циркулярні пили", "Електролобзики", "Акумуляторні болгарки (КШМ)"],
      },
    },
    "Шліфування / Полірування": {
      "_default": {
        query: "шліфмашина полірувальна",
        categories: ["Шліфувальні машини", "Акумуляторні шліфувальні машинки"],
      },
    },
    "Зварювання / Паяння": {
      "_default": {
        query: "зварювальний інвертор апарат",
        categories: [],
      },
    },
    "Фарбування / Оздоблення": {
      "_default": {
        query: "фарбопульт краскопульт",
        categories: ["Електиричні фарбопульти", "Фарборозпилювачі HP і MP", "Фарборозпилювачі HVLP", "Фарборозпилювачі LVMP"],
      },
    },
    "Вимірювання / Розмітка": {
      "_default": {
        query: "рівень лазерний рулетка",
        categories: ["Рівні будівельні", "Рівень лазерний", "Рулетки", "Вимірювальний інструмент"],
      },
    },
    "Ручний інструмент": {
      "_default": {
        query: "набір ключ викрутка",
        categories: ["Ручний інструмент"],
      },
    },
  };

  const catMap = toolMap[category];
  const materialKey = material || "_default";
  const mapping = catMap?.[materialKey] || catMap?.["_default"] || { query: category, categories: [] };

  // Build search query
  const parts = [mapping.query];
  if (powerSource && powerSource !== "Не має значення") {
    if (powerSource.includes("Акумулятор")) parts.push("акумуляторний");
    if (powerSource.includes("Мережевий")) parts.push("мережевий");
  }
  if (brand && brand !== "Без переваг — покажіть найкращі") {
    parts.push(brand);
  }
  if (budget) parts.push(budget);

  return { primary: parts.join(" "), categoryNames: mapping.categories };
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
      taskType, // Legacy support
    } = body;

    const category = toolCategory || taskType;
    if (!category || !budget) {
      return NextResponse.json(
        { error: "Недостатньо даних для підбору" },
        { status: 400 }
      );
    }

    const { primary: searchQuery, categoryNames } = buildSmartQuery(
      category, material, powerSource, brand, budget
    );

    // Build a natural language query for semantic search
    const naturalQuery = [
      category,
      material ? `для ${material}` : "",
      powerSource && powerSource !== "Не має значення" ? powerSource : "",
      brand && brand !== "Без переваг — покажіть найкращі" ? `бренд ${brand}` : "",
      specificTask || "",
    ].filter(Boolean).join(", ");

    // Run three searches in parallel:
    // 1. Direct category search (most precise)
    // 2. Keyword + semantic search (broader)
    // 3. Catalog context
    const categorySearchPromise = categoryNames.length > 0
      ? prisma.product.findMany({
          where: {
            isActive: true,
            category: { name: { in: categoryNames } },
            stock: { gt: 0 },
          },
          include: { category: true },
          orderBy: [{ stock: "desc" }, { price: "asc" }],
          take: 30,
        })
      : Promise.resolve([]);

    const [categoryProducts, catalog, searchResults] = await Promise.all([
      categorySearchPromise,
      getProductCatalogContext(),
      searchProductsForAI(`${searchQuery} | ${naturalQuery}`),
    ]);

    // Build extra context from direct category search results
    let categoryContext = "";
    if (categoryProducts.length > 0) {
      // Parse budget for filtering
      let budgetMin: number | undefined;
      let budgetMax: number | undefined;
      const budgetMatch = budget.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (budgetMatch) {
        budgetMin = parseInt(budgetMatch[1]);
        budgetMax = parseInt(budgetMatch[2]);
      }
      const upTo = budget.match(/до\s+(\d+)/i);
      if (upTo) budgetMax = parseInt(upTo[1]);
      const from = budget.match(/від\s+(\d+)/i);
      if (from) budgetMin = parseInt(from[1]);

      // Filter by budget if specified
      let filtered = categoryProducts;
      if (budgetMin || budgetMax) {
        filtered = categoryProducts.filter((p) => {
          if (budgetMin && p.price < budgetMin) return false;
          if (budgetMax && p.price > budgetMax) return false;
          return true;
        });
        // If budget filter leaves nothing, show all from category
        if (filtered.length === 0) filtered = categoryProducts;
      }

      // Filter by brand if specified
      if (brand && brand !== "Без переваг — покажіть найкращі") {
        const brandLower = brand.toLowerCase();
        const brandFiltered = filtered.filter((p) => p.name.toLowerCase().includes(brandLower));
        if (brandFiltered.length > 0) filtered = brandFiltered;
      }

      // Filter by power source
      if (powerSource && powerSource !== "Не має значення") {
        if (powerSource.includes("Акумулятор")) {
          const accFiltered = filtered.filter((p) =>
            p.name.toLowerCase().includes("акумулятор") ||
            p.category.name.toLowerCase().includes("акумулятор")
          );
          if (accFiltered.length > 0) filtered = accFiltered;
        } else if (powerSource.includes("Мережевий")) {
          const netFiltered = filtered.filter((p) =>
            !p.name.toLowerCase().includes("акумулятор") &&
            !p.category.name.toLowerCase().includes("акумулятор")
          );
          if (netFiltered.length > 0) filtered = netFiltered;
        }
      }

      const top = filtered.slice(0, 15);
      categoryContext = `\n\n🎯 ТОЧНІ РЕЗУЛЬТАТИ З КАТЕГОРІЇ (найбільш релевантні — рекомендуй САМЕ ЦІ товари!):\n`;
      for (const p of top) {
        const stock = p.stock > 0 ? `✅ ${p.stock} шт` : "❌ Немає";
        const desc = stripHtml(p.description || "").slice(0, 200);
        categoryContext += `  - 🔧 ${p.name} | ${p.price} грн | ${stock} | ${desc}\n`;
      }
    }

    const systemPrompt = getSystemPrompt("wizard") + "\n\n" + catalog + searchResults + categoryContext;

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
    filterHints.push("ФІЛЬТР: Рекомендуй ТІЛЬКИ інструменти (електро/ручні), а НЕ витратні матеріали, свердла, бури, диски, насадки, круги, щітки.");
    filterHints.push("ПРІОРИТЕТ: Використовуй товари з розділу 🎯 ТОЧНІ РЕЗУЛЬТАТИ З КАТЕГОРІЇ — вони найбільш релевантні для запиту клієнта.");

    const userMessage = `Підбери мені інструмент за наступними критеріями:

${details.join("\n")}

${filterHints.join("\n")}

ВАЖЛИВО: Рекомендуй ТІЛЬКИ товари з розділу РЕЗУЛЬТАТИ ПОШУКУ або ТОЧНІ РЕЗУЛЬТАТИ З КАТЕГОРІЇ вище. Використовуй точні назви та ціни.
Покажи ТОП 3-5 товарів що найкраще підходять під ці критерії. Поясни чому кожен підходить.
Дай фінальну рекомендацію — який один товар найкращий вибір і чому.
Якщо серед результатів немає товарів що відповідають УСІМ критеріям — чесно скажи і покажи найближчі альтернативи.`;

    const rawResponse = await chatWithGemini(
      [{ role: "user", parts: [{ text: userMessage }] }],
      systemPrompt,
      { useGoogleSearch: true }
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
        const words = name.split(/[\s,\-\/]+/).filter((w) => w.length >= 3);
        if (words.length >= 2) {
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

          let bestMatch: typeof allProducts[0] | null = null;
          let bestScore = 0;

          for (const p of allProducts) {
            if (usedIds.has(p.id)) continue;
            const pLower = p.name.toLowerCase();

            if (pLower === nameLower) { bestMatch = p; bestScore = 100; break; }

            let score = 0;
            if (pLower.includes(nameLower)) score += 50;
            if (nameLower.includes(pLower)) score += 40;

            for (const word of nameWords) {
              if (pLower.includes(word)) score += 10;
            }

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
