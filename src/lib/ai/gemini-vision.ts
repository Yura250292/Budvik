// Спільний транспорт для vision-викликів Gemini.
// Порт budvik-sklad-bot/src/geminiVision.js — при зміні там оновити й тут.
//
// Причина існування: раніше сканування робило один fetch без ретраю.
// Будь-який 429/503/обрив мережі = втрачений скан. Модель при цьому ні
// до чого — фото було нормальне.
//
// Fallback свідомо СИЛЬНІША модель, а не дешевша: він існує, щоб
// врятувати скан, з яким основна модель не впоралась (важке фото), а не
// щоб зекономити там, де економія й так мізерна.

import { ScanError } from "./scan-invoice";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export const PRIMARY_MODEL = "gemini-2.5-flash";
export const FALLBACK_MODEL = "gemini-3-flash-preview";

const RETRY_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 3000];

export interface VisionCallOptions {
  label?: string;
  base64: string;
  mimeType: string;
  systemPrompt: string;
  userText: string;
  generationConfig: Record<string, unknown>;
}

export interface VisionUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
}

export interface VisionResult {
  rawText: string;
  finishReason?: string;
  usage: VisionUsage | null;
  model: string;
  usedFallback: boolean;
  attempts: number;
}

interface RetryableError extends ScanError {
  retryable?: boolean;
  finishReason?: string;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function requestOnce(
  opts: VisionCallOptions & { model: string }
): Promise<Omit<VisionResult, "usedFallback" | "attempts">> {
  const { model, base64, mimeType, systemPrompt, userText, generationConfig } = opts;
  const url = `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ inlineData: { mimeType, data: base64 } }, { text: userText }],
          },
        ],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig,
      }),
    });
  } catch (e) {
    // Обрив мережі — fetch кидає TypeError, а не віддає res.
    const err = new ScanError("Мережева помилка", 503) as RetryableError;
    err.retryable = true;
    err.cause = e;
    throw err;
  }

  if (!res.ok) {
    const err = new ScanError(
      res.status === 429 ? "AI сервіс перевантажений" : `AI помилка: ${res.status}`,
      res.status === 429 ? 429 : 500
    ) as RetryableError;
    err.retryable = isRetryableStatus(res.status);
    throw err;
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const rawText: string = candidate?.content?.parts?.[0]?.text || "";
  const finishReason: string | undefined = candidate?.finishReason;

  // Порожня відповідь при OK-статусі: safety-фільтр або обрив по токенах.
  // Раніше виглядало як «погане фото» і збивало людину з пантелику.
  if (!rawText.trim()) {
    const err = new ScanError(
      finishReason === "MAX_TOKENS" ? "Відповідь AI не вмістилася" : "AI повернув порожню відповідь",
      422
    ) as RetryableError;
    err.retryable = finishReason !== "MAX_TOKENS";
    err.finishReason = finishReason;
    throw err;
  }

  return { rawText, finishReason, usage: data.usageMetadata || null, model };
}

export async function callGeminiVision(opts: VisionCallOptions): Promise<VisionResult> {
  if (!GEMINI_API_KEY) {
    throw new ScanError("AI сервіс не налаштований", 500);
  }

  const label = opts.label || "vision";
  let lastError: unknown;
  let attempts = 0;

  for (let i = 0; i < RETRY_ATTEMPTS; i++) {
    attempts++;
    try {
      const out = await requestOnce({ ...opts, model: PRIMARY_MODEL });
      if (i > 0) console.warn(`[${label}] успіх з ${attempts}-ї спроби (${PRIMARY_MODEL})`);
      return { ...out, usedFallback: false, attempts };
    } catch (e) {
      lastError = e;
      if (!(e as RetryableError).retryable) break;
      if (i < RETRY_ATTEMPTS - 1) {
        console.warn(`[${label}] спроба ${attempts} невдала (${(e as Error).message}), повтор`);
        await sleep(RETRY_DELAYS_MS[i]);
      }
    }
  }

  // Основна модель не впоралась — одна спроба сильнішою. Якщо й вона не
  // змогла, проблема у фото, і повтори лише крадуть час людини.
  attempts++;
  try {
    console.warn(`[${label}] перехід на ${FALLBACK_MODEL} після ${attempts - 1} невдалих спроб`);
    const out = await requestOnce({ ...opts, model: FALLBACK_MODEL });
    console.warn(`[${label}] успіх на fallback-моделі ${FALLBACK_MODEL}`);
    return { ...out, usedFallback: true, attempts };
  } catch (e) {
    console.error(`[${label}] fallback ${FALLBACK_MODEL} теж не впорався: ${(e as Error).message}`);
    throw lastError instanceof ScanError ? lastError : e;
  }
}

/** Знімає ```json-фенси, які модель іноді додає попри інструкцію. */
export function stripJsonFence(text: string): string {
  const trimmed = String(text || "").trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
}

/** Лог вартості. Без нього реальна ціна скана — здогадка. */
export function logUsage(
  label: string,
  usage: VisionUsage | null,
  model: string,
  usedFallback: boolean
): void {
  if (!usage) return;
  const inTok = usage.promptTokenCount ?? 0;
  const outTok = usage.candidatesTokenCount ?? 0;
  const think = usage.thoughtsTokenCount ?? 0;
  console.log(
    `[${label}] ${model}${usedFallback ? " (fallback)" : ""} — in:${inTok} out:${outTok}` +
      (think ? ` think:${think}` : "")
  );
}
