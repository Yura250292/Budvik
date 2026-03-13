import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatWithGemini } from "@/lib/ai/gemini";
import { getSystemPrompt } from "@/lib/ai/context";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !["ADMIN", "MANAGER", "SALES"].includes((session.user as any).role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { productId } = await req.json();

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

    const systemPrompt = getSystemPrompt("content");

    const userMessage = `Згенеруй повний контент для товару:

Назва: ${product.name}
Категорія: ${product.category.name}
Ціна: ${product.price} грн
Поточний опис: ${product.description}
Наявність: ${product.stock} шт

Згенеруй:
1. **Розширений опис** (200-300 слів)
2. **Переваги** (5-7 пунктів)
3. **Недоліки** (2-3 пункти)
4. **Сценарії використання** (3-5 сценаріїв)
5. **SEO-текст** (150 слів з ключовими словами "купити ${product.name}", "${product.category.name}")

Формат: markdown.`;

    const response = await chatWithGemini(
      [{ role: "user", parts: [{ text: userMessage }] }],
      systemPrompt
    );

    return NextResponse.json({
      productId: product.id,
      productName: product.name,
      generatedContent: response,
    });
  } catch (error: unknown) {
    console.error("AI Generate error:", error);
    return NextResponse.json({ error: "Помилка генерації контенту" }, { status: 500 });
  }
}
