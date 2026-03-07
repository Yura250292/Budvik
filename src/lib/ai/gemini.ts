const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyAQ9V_t1Cv1y-xAk0E5eq6IiyaYWkPJi_w";
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
  systemInstruction?: string
): Promise<string> {
  const body: Record<string, unknown> = {
    contents: messages,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const res = await fetch(
    `${GEMINI_BASE_URL}/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${err}`);
  }

  const data: GeminiResponse = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch(
    `${GEMINI_BASE_URL}/models/text-embedding-004:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
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
    `${GEMINI_BASE_URL}/models/text-embedding-004:batchEmbedContents?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: "models/text-embedding-004",
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
