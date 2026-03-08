import { NextResponse } from "next/server";
import { chatWithGemini, GeminiMessage } from "@/lib/ai/gemini";
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

  // Remove the products block from the response text
  const cleanResponse = response.replace(/```products\s*\n[\s\S]*?```/, "").trim();

  return { cleanResponse, productNames };
}

export async function POST(req: Request) {
  try {
    const { message, history = [] } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const allUserTexts = [
      ...history
        .filter((h: { role: string }) => h.role === "user")
        .map((h: { content: string }) => h.content),
      message,
    ].join(" ");

    const [catalog, searchResults] = await Promise.all([
      getProductCatalogContext(),
      searchProductsForAI(allUserTexts),
    ]);
    const systemPrompt = getSystemPrompt("consultant") + "\n\n" + catalog + searchResults;

    const messages: GeminiMessage[] = [
      ...history.map((h: { role: string; content: string }) => ({
        role: h.role === "user" ? ("user" as const) : ("model" as const),
        parts: [{ text: h.content }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const rawResponse = await chatWithGemini(messages, systemPrompt);

    // Parse product names from the AI response
    const { cleanResponse, productNames } = extractProductNames(rawResponse);

    let mentionedProducts: any[] = [];

    if (productNames.length > 0) {
      // Build flexible search conditions
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

      const allProducts = await prisma.product.findMany({
        where: {
          isActive: true,
          OR: searchConditions,
        },
        include: { category: true },
        take: 50,
      });

      // Smart matching with scoring
      const usedIds = new Set<string>();
      mentionedProducts = productNames
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

            if (score > bestScore) { bestScore = score; bestMatch = p; }
          }

          if (bestMatch && bestScore >= 15) {
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
          description: stripHtml(p.description || "").slice(0, 200),
          price: p.price,
          image: p.image,
          stock: p.stock,
          isPromo: p.isPromo,
          promoPrice: p.promoPrice,
          promoLabel: p.promoLabel,
          category: { name: p.category.name, slug: p.category.slug },
        }));
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
