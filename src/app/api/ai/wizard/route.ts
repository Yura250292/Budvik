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

    // Map task types to relevant tool keywords for better search
    const taskKeywords: Record<string, string> = {
      "Бетон / Цегла / Камінь": "перфоратор дриль бур зубило коронка долото бетон",
      "Дерево / Фанера / ДСП": "пила лобзик фрезер шліфмашина дриль свердло дерево",
      "Метал / Профіль / Труби": "болгарка різак зварювання дриль свердло метал труборіз",
      "Плитка / Кераміка": "плиткоріз болгарка коронка алмазний диск плитка",
      "Гіпсокартон / Сухі суміші": "шуруповерт міксер рубанок різак гіпсокартон",
      "Фарбування / Оздоблення": "фарбопульт валик шпатель шліфмашина фарба",
      "Вимірювання / Розмітка": "рівень рулетка лазерний далекомір кутомір",
      "Універсальне використання": "дриль шуруповерт болгарка набір інструмент",
    };
    const searchTerms = taskKeywords[taskType] || taskType;
    const searchQuery = `${searchTerms} ${budget}`;

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
