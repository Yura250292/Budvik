import { NextResponse } from "next/server";
import { chatWithGemini } from "@/lib/ai/gemini";
import { getProductCatalogContext, getSystemPrompt } from "@/lib/ai/context";

export async function POST(req: Request) {
  try {
    const { taskType, frequency, budget } = await req.json();

    if (!taskType || !frequency || !budget) {
      return NextResponse.json(
        { error: "taskType, frequency, and budget are required" },
        { status: 400 }
      );
    }

    const catalog = await getProductCatalogContext();
    const systemPrompt = getSystemPrompt("wizard") + "\n\n" + catalog;

    const userMessage = `Підбери мені інструменти для наступних потреб:

Тип роботи: ${taskType}
Частота використання: ${frequency}
Бюджет: ${budget}

Покажи ТОП 3-5 товарів з каталогу, порівняй їх та дай фінальну рекомендацію.
Використовуй markdown таблицю для порівняння.`;

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
