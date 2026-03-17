const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiMessage {
  role: "user" | "model";
  parts: { text: string }[];
}

export interface GeminiResponse {
  candidates: {
    content: {
      parts: { text: string }[];
    };
  }[];
}

export async function chatWithGemini(
  messages: GeminiMessage[],
  systemInstruction?: string,
  options?: { useGoogleSearch?: boolean }
): Promise<string> {
  const body: Record<string, unknown> = {
    contents: messages,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
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

  const url = `${GEMINI_BASE_URL}/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`;
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
    throw new Error(`Gemini API error: ${res.status} ${err}`);
  }

  const data: GeminiResponse = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
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
