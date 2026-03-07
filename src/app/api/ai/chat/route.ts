import { NextResponse } from "next/server";
import { chatWithGemini, GeminiMessage } from "@/lib/ai/gemini";
import { getProductCatalogContext, getSystemPrompt, searchProductsForAI } from "@/lib/ai/context";
import { prisma } from "@/lib/prisma";

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

export async function POST(req: Request) {
  try {
    const { message, history = [] } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // Collect search text from current message + all user messages in history
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

    const response = await chatWithGemini(messages, systemPrompt);

    // Find products mentioned in the AI response by matching product names
    const allProducts = await prisma.product.findMany({
      where: { isActive: true },
      include: { category: true },
    });

    // Match products that are mentioned in the AI response
    const responseLower = response.toLowerCase();
    const mentionedProducts = allProducts
      .filter((p) => {
        const nameLower = p.name.toLowerCase();
        // Check if product name (or significant part) appears in response
        if (responseLower.includes(nameLower)) return true;
        // Check for partial match (first 30+ chars of name)
        if (nameLower.length > 30 && responseLower.includes(nameLower.slice(0, 30))) return true;
        return false;
      })
      .slice(0, 10)
      .map((p) => ({
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

    return NextResponse.json({
      response,
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
