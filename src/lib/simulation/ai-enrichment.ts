import { chatWithGemini } from "@/lib/ai/gemini";

export interface AIQualityFactors {
  speedMod: number;
  durabilityMod: number;
  precisionMod: number;
  heatMod: number;
  confidence: number; // 0-1: how confident AI is in these factors
  reasoning: string;  // brief AI explanation
}

// In-memory cache: product name → AI factors (survives for the process lifetime)
const cache = new Map<string, { factors: AIQualityFactors; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours — product quality doesn't change often

function getCacheKey(name: string, mode: string): string {
  return `${mode}::${name.toLowerCase().trim()}`;
}

/**
 * Ask Gemini (with Google Search) to assess real-world quality of consumable products.
 * Returns quality multipliers for each product based on real reviews and test data.
 */
export async function aiEnrichConsumables(
  products: { name: string; price?: number | null }[],
  mode: string
): Promise<Map<string, AIQualityFactors>> {
  const result = new Map<string, AIQualityFactors>();

  // Check cache first — only request uncached products
  const uncached: { name: string; price?: number | null }[] = [];
  for (const p of products) {
    const key = getCacheKey(p.name, mode);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      result.set(p.name, cached.factors);
    } else {
      uncached.push(p);
    }
  }

  if (uncached.length === 0) return result;

  const modeLabels: Record<string, string> = {
    cutting_discs: "відрізних дисків",
    grinding_discs: "шліфувальних дисків",
    drill_bits: "свердел та бурів",
    chainsaw: "ланцюгів та бензопил",
  };

  const productList = uncached
    .map((p, i) => `${i + 1}. "${p.name}"${p.price ? ` (ціна: ${p.price} грн)` : ""}`)
    .join("\n");

  const prompt = `Ти — незалежний експерт з будівельних витратних матеріалів. Знайди в інтернеті реальні тести та відгуки про ці ${modeLabels[mode] || "витратні матеріали"}, потім оціни їх продуктивність.

ПРОДУКТИ:
${productList}

ПОШУК: Для кожного знайди:
- YouTube-огляди та порівняльні тести (назва + "тест", "огляд", "review", "test")
- Відгуки на rozetka.ua, prom.ua, amazon, aliexpress
- Форумні обговорення від реальних майстрів
- Дані про ресурс (скільки різів/метрів/отворів витримує)

Для КОЖНОГО продукту оціни 4 параметри як множники від 0.65 до 1.5:
- speed: швидкість роботи (1.0 = стандарт, 1.3 = на 30% швидший)
- durability: довговічність/кількість циклів до заміни (1.3 = на 30% довший ресурс)
- precision: якість обробки/чистота різу (1.2 = чистіший результат без задирок)
- heat: генерація тепла (0.8 = мало гріє — краще, 1.3 = сильно гріє — гірше)

Вкажи confidence (0.0-1.0):
- 0.8-1.0: знайшов реальні кількісні тести
- 0.5-0.7: знайшов відгуки майстрів або репутацію бренду
- 0.2-0.4: загальні знання про клас продукту
- 0.0-0.2: нема інформації, нейтральні оцінки

Відповідай ТІЛЬКИ валідним JSON масивом без markdown:
[
  {"name": "повна назва продукту", "speed": 1.1, "durability": 1.15, "precision": 1.05, "heat": 0.9, "confidence": 0.75, "reasoning": "конкретне пояснення з джерелом або даними"},
  ...
]

Орієнтири по брендах:
- Топ-рівень (Bosch Professional, Makita, Hilti, Klingspor, Norton, Pferd): speed 1.1-1.25, durability 1.2-1.4, confidence 0.6-0.8
- Середній рівень (Bosch DIY, Metabo, Stanley): speed 1.0-1.1, durability 1.0-1.15, confidence 0.5-0.65
- Бюджет (невідомий бренд, китайський no-name): speed 0.8-0.95, durability 0.65-0.85, confidence 0.3-0.45
- Враховуй ціну в порівнянні — дорожчий не завжди кращий за $ витрат
- НЕ вигадуй тести та цифри — якщо не знаєш, постав confidence нижче 0.3 і reasoning "Інформація відсутня"`;

  const systemMsg = "Ти AI-аналітик якості будівельних інструментів. Відповідай тільки валідним JSON. Не додавай пояснень за межами JSON.";

  try {
    const messages: { role: "user" | "model"; parts: { text: string }[] }[] = [
      { role: "user", parts: [{ text: prompt }] },
    ];

    let response: string;
    try {
      response = await chatWithGemini(messages, systemMsg, { useGoogleSearch: true });
    } catch {
      // Fallback without Google Search
      response = await chatWithGemini(messages, systemMsg);
    }

    // Parse JSON from response (handle potential markdown wrapping)
    const jsonStr = response.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed: Array<{
      name: string;
      speed: number;
      durability: number;
      precision: number;
      heat: number;
      confidence: number;
      reasoning: string;
    }> = JSON.parse(jsonStr);

    if (!Array.isArray(parsed)) throw new Error("Expected array");

    // Map results back to products
    for (let i = 0; i < uncached.length; i++) {
      const aiResult = parsed[i];
      if (!aiResult) continue;

      const factors: AIQualityFactors = {
        speedMod: clamp(aiResult.speed ?? 1.0, 0.5, 2.0),
        durabilityMod: clamp(aiResult.durability ?? 1.0, 0.5, 2.0),
        precisionMod: clamp(aiResult.precision ?? 1.0, 0.5, 2.0),
        heatMod: clamp(aiResult.heat ?? 1.0, 0.5, 2.0),
        confidence: clamp(aiResult.confidence ?? 0.5, 0, 1),
        reasoning: aiResult.reasoning || "",
      };

      result.set(uncached[i].name, factors);

      // Cache the result
      const key = getCacheKey(uncached[i].name, mode);
      cache.set(key, { factors, timestamp: Date.now() });
    }
  } catch (error) {
    console.error("AI enrichment failed:", error);
    // Return empty — caller will use heuristic fallback
  }

  return result;
}

/**
 * Blend AI factors with heuristic factors.
 * AI confidence determines the blend ratio.
 */
export function blendFactors(
  heuristic: { speedFactor: number; durabilityFactor: number; precisionFactor: number; heatFactor: number },
  ai: AIQualityFactors | undefined
): { speedFactor: number; durabilityFactor: number; precisionFactor: number; heatFactor: number; aiReasoning?: string } {
  if (!ai || ai.confidence < 0.1) {
    return heuristic;
  }

  // Blend ratio: AI confidence determines how much AI overrides heuristic
  // confidence 0.3 → 30% AI, 70% heuristic
  // confidence 0.8 → 80% AI, 20% heuristic
  const w = ai.confidence;

  return {
    speedFactor: round2(heuristic.speedFactor * lerp(1.0, ai.speedMod, w)),
    durabilityFactor: round2(heuristic.durabilityFactor * lerp(1.0, ai.durabilityMod, w)),
    precisionFactor: round2(heuristic.precisionFactor * lerp(1.0, ai.precisionMod, w)),
    heatFactor: round2(heuristic.heatFactor * lerp(1.0, ai.heatMod, w)),
    aiReasoning: ai.reasoning || undefined,
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
