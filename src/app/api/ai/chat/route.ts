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
      // Find products by exact or partial name match
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

      // Match and order products according to AI's recommendation order
      mentionedProducts = productNames
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
