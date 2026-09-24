/**
 * Синтез мовлення: текст відповіді → живий голос.
 *
 * НАВІЩО СЕРВЕР, коли в браузері є speechSynthesis. Системний синтезатор
 * українською звучить механічно — скарга власника 24.09.2026 на режим
 * розмови: «дуже штучний». Нейромережевий голос звучить як людина.
 *
 * ГОЛОС — Gemini «Charon». Власник обрав його на слух із восьми (OpenAI
 * marin/cedar/coral/ash, Gemini Kore/Charon/Aoede/Orus) у пробі
 * scripts/probe-tts-voices.mts 24.09.2026. Готовий звук Gemini віддає за
 * 7,5–8,5 с — для розмови задовго, — але ПОТОКОМ перший шматок приходить
 * за 1,4 с. Тому все тут потокове: сервер перекладає події Gemini у сирий
 * звук і передає далі, браузер грає, поки синтезується решта.
 *
 * ФОРМАТ — сирий PCM: 16 біт, 24 кГц, моно, little-endian. Такий віддає
 * Gemini, і такий самий уміє OpenAI (response_format "pcm"), тож запасний
 * постачальник вмикається змінною TTS_PROVIDER=openai, а програвач у
 * браузері один.
 *
 * Налаштування — у змінних середовища, щоб перемкнути без деплою:
 * TTS_PROVIDER (gemini | openai), TTS_VOICE, TTS_MODEL, TTS_INSTRUCTIONS.
 * Нічого не зберігаємо: текст іде в синтез, звук — людині, і все.
 */

export const TTS_SAMPLE_RATE = 24_000;

/** Довше — це вже не репліка, а доповідь: озвучуємо лише початок. */
export const TTS_MAX_CHARS = 1_200;

const PROVIDER = process.env.TTS_PROVIDER === "openai" ? "openai" : "gemini";
/** Скільки чекати, поки постачальник почне відповідати. */
const TIMEOUT_MS = 15_000;

/**
 * Як говорити. Обидві моделі слухаються опису манери словами — саме це й
 * знімає «читання робота»: паузи, наголос на числах, діловий тон.
 */
const STYLE =
  process.env.TTS_INSTRUCTIONS ||
  "Говори українською природно й спокійно, як досвідчений фінансовий помічник керівника: тепло, впевнено, діловим тоном, без театральності, у помірному темпі з природними паузами.";

function geminiKey(): string | undefined {
  return process.env.TTS_API_KEY || process.env.ASSISTANT_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
}

function openaiKey(): string | undefined {
  return process.env.TTS_API_KEY || process.env.OPENAI_API_KEY;
}

export function ttsConfigured(): boolean {
  return Boolean(PROVIDER === "gemini" ? geminiKey() : openaiKey());
}

/**
 * Потік сирого звуку. null — синтез недоступний (немає ключа, відмова,
 * таймаут до першого байта): тоді браузер озвучить сам, гірше, але не мовчки.
 */
export async function synthesize(text: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
  const input = text.slice(0, TTS_MAX_CHARS);
  /*
   * Таймаут — лише до ПЕРШОЇ відповіді постачальника. AbortSignal.timeout на
   * весь запит обрізав би довгу репліку посередині: звук іде потоком довше,
   * ніж чекаємо на його початок.
   */
  const upstream = new AbortController();
  const timer = setTimeout(() => upstream.abort(), TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, upstream.signal]) : upstream.signal;
  try {
    return PROVIDER === "openai" ? await openai(input, combined) : await gemini(input, combined);
  } catch (e) {
    console.error(`[tts] ${PROVIDER}`, (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function openai(text: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
  const key = openaiKey();
  if (!key) return null;
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.TTS_MODEL || "gpt-4o-mini-tts",
      voice: process.env.TTS_VOICE || "marin",
      input: text,
      instructions: STYLE,
      response_format: "pcm",
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    console.error("[tts] openai", res.status, (await res.text().catch(() => "")).slice(0, 300));
    return null;
  }
  return res.body;
}

/**
 * Gemini віддає звук подіями SSE: у кожній — шматок base64 у
 * inlineData. Події розділені порожнім рядком, і в цьому API він
 * CRLF («\r\n\r\n») — розбір за «\n\n» не знаходив жодної події (проба
 * 24.09.2026), тож ділимо за обома.
 */
async function gemini(text: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
  const key = geminiKey();
  if (!key) return null;
  const model = process.env.TTS_MODEL || "gemini-3.1-flash-tts-preview";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${STYLE}\n\n${text}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.TTS_VOICE || "Charon" } } },
        },
      }),
      signal,
    }
  );
  if (!res.ok || !res.body) {
    console.error("[tts] gemini", res.status, (await res.text().catch(() => "")).slice(0, 300));
    return null;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const events = buffer.split(/\r?\n\r?\n/);
        if (events.length > 1) {
          buffer = events.pop() ?? "";
          let sent = false;
          for (const event of events) {
            const data = event
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5))
              .join("");
            if (!data) continue;
            try {
              const parts = JSON.parse(data)?.candidates?.[0]?.content?.parts ?? [];
              for (const part of parts) {
                if (part?.inlineData?.data) {
                  controller.enqueue(Buffer.from(part.inlineData.data, "base64"));
                  sent = true;
                }
              }
            } catch {
              // неповна чи службова подія — пропускаємо
            }
          }
          if (sent) return;
          continue;
        }
        if (ended) {
          controller.close();
          return;
        }
        const { done, value } = await reader.read();
        if (done) {
          // Остання подія може прийти без порожнього рядка після себе — дорозбираємо її.
          ended = true;
          buffer += "\n\n";
          continue;
        }
        buffer += decoder.decode(value, { stream: true });
      }
    },
    cancel() {
      void reader.cancel();
    },
  });
}
