const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Модель — псевдонім «остання flash», а не конкретна версія.
 *
 * Тут стояло `gemini-2.0-flash`, і 08.09.2026 Google просто зняв її з роздачі:
 * усі виклики почали віддавати 404 «no longer available», а на вітрині блок
 * «Сумісні аксесуари» падав з 500 на КОЖНІЙ картці товару. Разом із ним
 * мовчали чат, візард, підтримка, генерація, аналітика й розпізнавання
 * одометра — вісім місць через один рядок.
 *
 * Псевдонім `-latest` Google веде сам, тож така поломка не повторюється.
 * Треба прибити конкретну версію — `GEMINI_MODEL` у змінних оточення.
 */
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

export interface GeminiMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

export interface GeminiResponse {
  candidates: {
    content: {
      // text необовʼязковий: у частині-міркуванні його немає взагалі.
      parts: { text?: string }[];
    };
  }[];
}

export async function chatWithGemini(
  messages: GeminiMessage[],
  systemInstruction?: string,
  options?: { useGoogleSearch?: boolean; thinking?: boolean }
): Promise<string> {
  const body: Record<string, unknown> = {
    contents: messages,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
      // Міркування вимкнені навмисно: на тому самому запиті відповідь приходить
      // за 3,9 с проти 12,7 с з ними, а підбір аксесуарів і чат від міркувань
      // не кращі. Кому потрібно — передає thinking: true.
      ...(options?.thinking ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
    },
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  // Enable Google Search grounding — AI can search internet for missing specs
  if (options?.useGoogleSearch) {
    body.tools = [{ google_search: {} }];
  }

  const url = `${GEMINI_BASE_URL}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const fetchOptions = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };

  let res = await fetch(url, fetchOptions);

  // Auto-retry once on rate limit (429)
  if (res.status === 429) {
    const retryAfter = Math.min(
      parseInt(res.headers.get("retry-after") || "35", 10),
      40
    );
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    res = await fetch(url, fetchOptions);
  }

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 429) {
      throw new Error("AI сервіс тимчасово перевантажений. Спробуйте через хвилину.");
    }
    // 404 означає рівно одне: моделі більше немає. Пишемо це словами, бо
    // «Gemini API error: 404» коштувало нам вісьмох мовчазних поломок.
    if (res.status === 404) {
      throw new Error(
        `Модель «${GEMINI_MODEL}» більше не віддається Google. ` +
          `Задайте живу назву у змінній GEMINI_MODEL. Відповідь Google: ${err.slice(0, 300)}`
      );
    }
    throw new Error(`Gemini API error: ${res.status} ${err}`);
  }

  const data: GeminiResponse = await res.json();
  // Склеюємо ВСІ частини, а не першу: моделі з міркуваннями віддають кілька
  // частин, і текст відповіді буває не в нульовій — з `parts[0].text` виходила
  // порожня відповідь при цілком успішному запиті.
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("") || ""
  );
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch(
    `${GEMINI_BASE_URL}/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text }] },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embedding API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.embedding?.values || [];
}

export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(
    `${GEMINI_BASE_URL}/models/gemini-embedding-001:batchEmbedContents?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text }] },
        })),
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Batch Embedding API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.embeddings?.map((e: { values: number[] }) => e.values) || [];
}
