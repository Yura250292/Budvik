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

    const resultsDescription = results.map((r: any, i: number) => {
      const name = r.consumableName || r.toolName || toolNames?.[i] || `Інструмент ${i + 1}`;
      return `${i + 1}. "${name}":
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

Результати:
${resultsDescription}

Дай коротку та корисну відповідь УКРАЇНСЬКОЮ (3-5 речень):
1. Який варіант найкращий і чому
2. Коли краще обрати інший варіант
3. Практична порада для користувача

Відповідай конкретно, без загальних фраз. Використовуй назви інструментів/матеріалів.`;

    const analysis = await chatWithGemini(
      [{ role: "user", parts: [{ text: prompt }] }],
      "Ти AI-консультант магазину будівельних інструментів БУДВІК. Відповідай коротко, конкретно, українською мовою. Уникай маркетингових фраз."
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
