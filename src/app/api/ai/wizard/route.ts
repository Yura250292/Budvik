import { NextResponse } from "next/server";
import { chatWithGemini } from "@/lib/ai/gemini";
import { getProductCatalogContext, getSystemPrompt, searchProductsForAI } from "@/lib/ai/context";

export async function POST(req: Request) {
  try {
    const { taskType, frequency, budget } = await req.json();

    if (!taskType || !frequency || !budget) {
      return NextResponse.json(
        { error: "taskType, frequency, and budget are required" },
        { status: 400 }
      );
    }

    // Search for real products matching the task type and budget
    const searchQuery = `${taskType} ${budget}`;
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
Покажи ТОП 3-5 товарів, порівняй їх у таблиці та дай фінальну рекомендацію.`;

    const response = await chatWithGemini(
      [{ role: "user", parts: [{ text: userMessage }] }],
      systemPrompt
    );

    return NextResponse.json({ response });
  } catch (error: unknown) {
    console.error("AI Wizard error:", error);
    return NextResponse.json(
      { error: "Помилка AI сервісу" },
      { status: 500 }
    );
  }
}
