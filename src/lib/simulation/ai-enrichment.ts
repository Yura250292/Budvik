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
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

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

  const prompt = `Ти експерт з будівельних витратних матеріалів. Знайди в інтернеті інформацію про якість цих ${modeLabels[mode] || "витратних матеріалів"} та оціни їх продуктивність:

${productList}

Для КОЖНОГО продукту оціни 4 параметри як множники від 0.7 до 1.5:
- speed: швидкість роботи (1.0 = стандарт, >1.0 = швидший)
- durability: довговічність/стійкість до зносу (>1.0 = довше служить)
- precision: точність/якість обробки (>1.0 = чистіший результат)
- heat: генерація тепла (менше = краще, 0.8 = мало гріє, 1.2 = сильно гріє)

Також вкажи confidence (0.0-1.0) — наскільки ти впевнений у оцінці (1.0 = знайшов реальні тести).

Відповідай ТІЛЬКИ валідним JSON масивом без markdown:
[
  {"name": "повна назва продукту", "speed": 1.1, "durability": 1.05, "precision": 1.0, "heat": 0.95, "confidence": 0.8, "reasoning": "коротке пояснення"},
  ...
]

Правила:
- Якщо знайшов реальні тести/відгуки — базуй оцінку на них (confidence >= 0.7)
- Якщо тільки загальна репутація бренду — використовуй її (confidence 0.4-0.6)
- Якщо нічого не знайшов — дай нейтральні оцінки (confidence < 0.3)
- Преміум бренди (Bosch, Makita, Hilti, Klingspor, Norton): speed 1.1-1.2, durability 1.15-1.3
- Бюджетні бренди: speed 0.85-0.95, durability 0.7-0.85
- Враховуй ціну: дорожчий продукт зазвичай кращий (але не завжди)
- НЕ вигадуй тести — якщо не знаєш, постав confidence < 0.3`;

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
