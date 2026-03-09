import { NextResponse } from "next/server";
import { chatWithGemini, GeminiMessage } from "@/lib/ai/gemini";
import { getProductCatalogContext, getSystemPrompt, searchProductsForAI } from "@/lib/ai/context";
import { prisma } from "@/lib/prisma";

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

interface ProductComparison {
  name: string;
  specs?: Record<string, string>;
  pros?: string[];
  cons?: string[];
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

export async function POST(req: Request) {
  try {
    const { message, history = [] } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // Use current message as primary search, add last user message for context
    const lastUserMsg = history
      .filter((h: { role: string }) => h.role === "user")
      .map((h: { content: string }) => h.content)
      .slice(-1)[0];
    const searchQuery = lastUserMsg ? `${message} ${lastUserMsg}` : message;

    const [catalog, searchResults] = await Promise.all([
      getProductCatalogContext(),
      searchProductsForAI(searchQuery),
    ]);
    const systemPrompt = getSystemPrompt("consultant") + "\n\n" + catalog + searchResults;

    const messages: GeminiMessage[] = [
      ...history.map((h: { role: string; content: string }) => ({
        role: h.role === "user" ? ("user" as const) : ("model" as const),
        parts: [{ text: h.content }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const rawResponse = await chatWithGemini(messages, systemPrompt, { useGoogleSearch: true });

    // Extract comparison block first, then product names
    const { cleanResponse: withoutComparison, comparison } = extractComparison(rawResponse);
    const { cleanResponse, productNames } = extractProductNames(withoutComparison);

    let mentionedProducts: any[] = [];

    if (productNames.length > 0) {
      // Strategy: try EXACT search first for each name, then fall back to fuzzy
      // This prevents wrong matches like "Grosser GPS 301" when looking for "Grosser GCD 521T"

      // Extract model numbers (alphanumeric codes like GCD521T, D650, 13/850)
      function extractModelCodes(name: string): string[] {
        const codes: string[] = [];
        // Match patterns like "GCD 521T", "GAG 120R", "D650", "13/850", "OS-20"
        const modelPatterns = name.match(/[A-Z]{2,}[\s\-]?\d{2,}[A-Z]*/gi) || [];
        codes.push(...modelPatterns.map((m) => m.replace(/\s+/g, "")));
        // Match article numbers in parentheses like (1941055)
        const articleMatch = name.match(/\((\d{5,})\)/);
        if (articleMatch) codes.push(articleMatch[1]);
        return codes;
      }

      // First: try exact name search for each product
      const exactSearches = productNames.map((name) =>
        prisma.product.findMany({
          where: {
            isActive: true,
            name: { contains: name, mode: "insensitive" as const },
          },
          include: { category: true },
          take: 5,
        })
      );

      // Also build broad search as fallback
      const searchConditions = productNames.flatMap((name) => {
        const conditions = [
          { name: { contains: name.slice(0, 40), mode: "insensitive" as const } },
        ];
        // Add model code searches (most precise identifiers)
        const models = extractModelCodes(name);
        for (const model of models) {
          conditions.push({ name: { contains: model, mode: "insensitive" as const } });
        }
        return conditions;
      });

      const [exactResults, broadProducts] = await Promise.all([
        Promise.all(exactSearches),
        prisma.product.findMany({
          where: { isActive: true, OR: searchConditions },
          include: { category: true },
          take: 50,
        }),
      ]);

      // Merge all products (dedup)
      const allProductsMap = new Map<string, typeof broadProducts[0]>();
      for (const results of exactResults) {
        for (const p of results) allProductsMap.set(p.id, p);
      }
      for (const p of broadProducts) {
        if (!allProductsMap.has(p.id)) allProductsMap.set(p.id, p);
      }
      const allProducts = Array.from(allProductsMap.values());

      // Smart matching with model-number priority
      const usedIds = new Set<string>();
      mentionedProducts = productNames
        .map((name, nameIdx) => {
          // First: check if exact search found it
          const exactMatch = exactResults[nameIdx]?.[0];
          if (exactMatch && !usedIds.has(exactMatch.id)) {
            usedIds.add(exactMatch.id);
            return exactMatch;
          }

          const nameLower = name.toLowerCase().trim();
          const nameModels = extractModelCodes(name);
          const nameWords = nameLower.split(/[\s,\-\/]+/).filter((w) => w.length >= 3);

          let bestMatch: typeof allProducts[0] | null = null;
          let bestScore = 0;

          for (const p of allProducts) {
            if (usedIds.has(p.id)) continue;
            const pLower = p.name.toLowerCase();

            // Exact match
            if (pLower === nameLower) { bestMatch = p; bestScore = 200; break; }

            let score = 0;

            // Model number match — strongest signal (GCD521T in both names)
            const pModels = extractModelCodes(p.name);
            for (const nm of nameModels) {
              for (const pm of pModels) {
                if (nm.toLowerCase() === pm.toLowerCase()) score += 80;
              }
            }

            // Full name containment
            if (pLower.includes(nameLower)) score += 50;
            if (nameLower.includes(pLower)) score += 40;

            // Word matching
            for (const word of nameWords) {
              if (pLower.includes(word)) score += 5;
            }

            if (score > bestScore) { bestScore = score; bestMatch = p; }
          }

          if (bestMatch && bestScore >= 20) {
            usedIds.add(bestMatch.id);
            return bestMatch;
          }
          return null;
        })
        .filter(Boolean)
        .map((p: any) => {
          // Match comparison data to this product
          const comp = comparison.find((c) => {
            const cLower = c.name.toLowerCase();
            const pLower = p.name.toLowerCase();
            return pLower === cLower || pLower.includes(cLower) || cLower.includes(pLower.slice(0, 25));
          });

          return {
            id: p.id,
            name: p.name,
            slug: p.slug,
            description: stripHtml(p.description || "").slice(0, 200),
            price: p.price,
            image: p.image,
            stock: p.stock,
            isPromo: p.isPromo,
            promoPrice: p.promoPrice,
            promoLabel: p.promoLabel,
            category: { name: p.category.name, slug: p.category.slug },
            specs: comp?.specs || {},
            pros: comp?.pros || [],
            cons: comp?.cons || [],
          };
        });
    }

    return NextResponse.json({
      response: cleanResponse,
      products: mentionedProducts,
    });
  } catch (error: unknown) {
    console.error("AI Chat error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    const isRateLimit = msg.includes("перевантажений") || msg.includes("429");
    return NextResponse.json(
      {
        error: isRateLimit
          ? "AI сервіс тимчасово перевантажений. Спробуйте через хвилину."
          : "Помилка AI сервісу. Спробуйте пізніше.",
      },
      { status: isRateLimit ? 429 : 500 }
    );
  }
}
