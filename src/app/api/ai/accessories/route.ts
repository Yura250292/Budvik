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

    // Match suggested products with actual catalog
    const allProducts = await prisma.product.findMany({
      where: { isActive: true, id: { not: productId } },
      include: { category: true },
    });

    const matched = suggestions
      .map((s) => {
        const found = allProducts.find(
          (p) => p.name.toLowerCase().includes(s.name.toLowerCase().slice(0, 20)) ||
                 s.name.toLowerCase().includes(p.name.toLowerCase().slice(0, 20))
        );
        return found ? { ...found, reason: s.reason } : null;
      })
      .filter(Boolean);

    // If AI didn't find matches, fallback to same category
    if (matched.length === 0) {
      const fallback = allProducts
        .filter((p) => p.categoryId !== product.categoryId)
        .slice(0, 4);
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
