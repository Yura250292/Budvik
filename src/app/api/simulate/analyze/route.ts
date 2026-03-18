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

    const prompt = `Ти — незалежний технічний експерт з електроінструментів для магазину БУДВІК.

ЗАВДАННЯ: Порівняй продукти для операції "${typeLabels[simType] || simType}" на матеріалі "${materialName || "невідомий"}".

ПРОДУКТИ ДЛЯ АНАЛІЗУ:
${productNames.map((n: string, i: number) => `${i + 1}. ${n}`).join("\n")}

КРОК 1 — ПОШУК В ІНТЕРНЕТІ:
Знайди для кожного продукту:
- Відеоогляди та тести на YouTube (укр./рос. назва + "огляд", "тест", "review")
- Відгуки на rozetka.com.ua, epicentrk.ua, prom.ua
- Обговорення на форумах (master.ru, stroy-forum.ru, forumhouse.ru)
- Реальні порівняльні тести незалежних тестувальників
- Типові скарги та хвалебні відгуки від майстрів

КРОК 2 — РЕЗУЛЬТАТИ СИМУЛЯЦІЇ:
${resultsDescription}

КРОК 3 — ВІДПОВІДЬ УКРАЇНСЬКОЮ (10-15 речень, конкретно і по суті):

**ПЕРЕМОЖЕЦЬ:** Який варіант кращий для цієї задачі і чому — з конкретними цифрами різниці.

**КЛЮЧОВІ ВІДМІННОСТІ:** Що реально відрізняє ці продукти (потужність, матеріал корпусу, ресурс деталей, технологія двигуна).

**РЕАЛЬНІ ДАНІ:** Якщо знайшов відеотести або форумні звіти — наведи конкретні результати (хвилини роботи, кількість різів/отворів, реальний ресурс). Якщо не знайшов — скажи це ЧЕСНО.

**НЕДОЛІКИ КОЖНОГО:** Реальні мінуси з відгуків (перегрів, вібрація, якість збірки, ресурс щіток тощо). Не маркетинг — тільки факти.

**ДЛЯ КОГО:** При якому сценарії обрати перший, коли — другий (об'єм робіт, матеріали, частота використання).

**ЦІНА/ЯКІСТЬ:** Який вигідніший з урахуванням довгострокових витрат (ресурс, вартість обслуговування, запчастини).

Правила:
- Використовуй повні назви продуктів
- Якщо знайшов реальні тести — цитуй конкретні цифри
- Не вигадуй відгуки та тести
- Уникай загальних фраз типу "відмінно підходить", "якісний інструмент"`;

    const systemMsg = "Ти AI-консультант магазину БУДВІК. Відповідай конкретно, українською, без маркетингу. Якщо знайшов реальні відгуки/тести — використовуй конкретні дані. Якщо не знайшов — скажи це чесно і спирайся на симуляцію. Не вигадуй інформацію.";
    const messages: { role: "user" | "model"; parts: { text: string }[] }[] = [
      { role: "user", parts: [{ text: prompt }] },
    ];

    // Try with Google Search first (20s timeout), fallback to plain Gemini (15s timeout)
    const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
        ),
      ]);

    let analysis: string;
    try {
      analysis = await withTimeout(
        chatWithGemini(messages, systemMsg, { useGoogleSearch: true }),
        20000
      );
    } catch {
      try {
        analysis = await withTimeout(
          chatWithGemini(messages, systemMsg),
          15000
        );
      } catch {
        return NextResponse.json({ analysis: null });
      }
    }

    return NextResponse.json({ analysis });
  } catch (error: any) {
    console.error("AI analysis error:", error?.message || error);
    return NextResponse.json(
      { error: "Не вдалося отримати AI аналіз", details: error?.message },
      { status: 500 }
    );
  }
}
