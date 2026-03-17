import { NextResponse } from "next/server";
import { chatWithGemini } from "@/lib/ai/gemini";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { results, materialName, simType, toolNames } = body;

    if (!results || !Array.isArray(results) || results.length === 0) {
      return NextResponse.json({ error: "Потрібні результати симуляції" }, { status: 400 });
    }

    const typeLabels: Record<string, string> = {
      cutting: "різання",
      grinding: "шліфування",
      drilling: "свердління",
    };

    const productNames = results.map((r: any, i: number) =>
      r.consumableName || r.toolName || toolNames?.[i] || `Інструмент ${i + 1}`
    );

    const resultsDescription = results.map((r: any, i: number) => {
      return `${i + 1}. "${productNames[i]}":
   - Час: ${r.estimatedTimeSec} сек
   - Ефективність: ${r.efficiencyScore}/100
   - Швидкість: ${r.metrics.speed}/100
   - Точність: ${r.metrics.precision}/100
   - Довговічність: ${r.metrics.durability}/100
   - Безпека: ${r.metrics.safety}/100
   - Знос: ${r.wearRate}
   - Нагрів: ${r.heatLevel}
   - Попередження: ${r.warnings?.length ? r.warnings.join("; ") : "немає"}`;
    }).join("\n\n");

    const prompt = `Ти — експерт з будівельних інструментів та витратних матеріалів. Проаналізуй результати симуляції ${typeLabels[simType] || simType} на матеріалі "${materialName || "невідомий"}".

Знайди в інтернеті реальні відгуки та характеристики цих продуктів:
${productNames.map((n: string, i: number) => `${i + 1}. "${n}"`).join("\n")}

Результати симуляції:
${resultsDescription}

Дай відповідь УКРАЇНСЬКОЮ (5-8 речень):
1. Який варіант найкращий і чому — враховуючи як симуляцію, так і реальні відгуки з інтернету
2. Які реальні переваги/недоліки кожного продукту за відгуками (якщо знайдено)
3. Коли краще обрати інший варіант
4. Співвідношення ціна/якість — який вигідніший

Відповідай конкретно, без загальних фраз. Використовуй назви продуктів. Якщо знайшов реальні відгуки — цитуй ключові моменти.`;

    const analysis = await chatWithGemini(
      [{ role: "user", parts: [{ text: prompt }] }],
      "Ти AI-консультант магазину будівельних інструментів БУДВІК. Відповідай конкретно, українською мовою. Уникай маркетингових фраз. Якщо є інформація з інтернету — використовуй її для порівняння. Не вигадуй інформацію — якщо не знайшов відгуків, скажи це чесно.",
      { useGoogleSearch: true }
    );

    return NextResponse.json({ analysis });
  } catch (error: any) {
    console.error("AI analysis error:", error);
    return NextResponse.json(
      { error: "Не вдалося отримати AI аналіз", analysis: null },
      { status: 500 }
    );
  }
}
