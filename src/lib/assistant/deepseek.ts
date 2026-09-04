/**
 * Дріт до DeepSeek: один запит зі стрімом і накопиченням викликів інструментів.
 *
 * Без SDK, звичайним fetch — так само, як АІ-помічник аналітики
 * (admin/sales-analytics/ask). Причина та сама: потрібні три поля з
 * відповіді, а не клієнтська бібліотека з власним життєвим циклом.
 *
 * Стрім тут не заради краси. Хід із інструментами триває десятки секунд, і
 * без потоку користувач стільки дивиться в порожній екран, а з'єднання
 * ризикує впасти по таймауту проксі.
 *
 * Головна тонкість — фрагменти tool_calls. Модель віддає їх шматками, і
 * склеювати треба ЗА ПОЛЕМ index, а не за порядком надходження: у першому
 * фрагменті приходять id та ім'я, у наступних — по кілька символів
 * arguments, і фрагменти різних викликів чергуються.
 */

import { CALL_TIMEOUT_MS, DEEPSEEK_URL, MODEL, TEMPERATURE } from "@/lib/assistant/config";
import type { ChatMessage, ToolCall, ToolSchema, Usage } from "@/lib/assistant/types";

export class DeepSeekError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export type ChatResult = {
  content: string;
  toolCalls: ToolCall[];
  /** "tool_calls" | "stop" | "length" — від нього залежить, що робити далі. */
  finishReason: string;
  usage: Usage | null;
};

type DeltaToolCall = {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
};

export async function streamChat(opts: {
  apiKey: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  /** "none" — заборонити інструменти й вимагати текст. */
  toolChoice: "auto" | "none";
  maxTokens: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): Promise<ChatResult> {
  const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: opts.messages,
        /**
         * Інструменти надсилаємо ЗАВЖДИ, а забороняємо їх через
         * tool_choice: "none".
         *
         * Спокуса прибрати їх зі списку на останньому раунді дорого
         * коштувала: історія розмови вже містить виклики інструментів, і
         * модель, не побачивши їх у запиті, віддала СЛУЖБОВУ РОЗМІТКУ
         * виклику як звичайний текст — користувач отримав у відповідь
         * шматок внутрішнього формату. З явним "none" вона знає, що
         * інструменти є, але цього разу не її черга ними користуватись.
         */
        ...(opts.tools.length > 0
          ? { tools: opts.tools, tool_choice: opts.toolChoice }
          : {}),
        max_tokens: opts.maxTokens,
        temperature: TEMPERATURE,
        // Міркування вимкнені навмисно: помічник обирає інструмент і
        // переказує готові числа — це не та задача, де довше думання дає
        // кращу відповідь, зате воно коштує секунд десять на хід.
        thinking: { type: "disabled" },
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    });
  } catch (e) {
    const reason = (e as Error).name === "TimeoutError" ? "не відповіла вчасно" : (e as Error).message;
    throw new DeepSeekError(`Модель ${reason}`, 504);
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    console.error("[assistant] deepseek", res.status, detail.slice(0, 400));
    throw new DeepSeekError(`Помилка моделі (${res.status})`, res.status === 429 ? 429 : 502);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";
  let content = "";
  let finishReason = "stop";
  let usage: Usage | null = null;
  const calls = new Map<number, { id: string; name: string; args: string }>();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Події SSE відділені порожнім рядком; \r\n трапляється за проксі.
    const parts = buffer.replace(/\r\n/g, "\n").split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      for (const line of part.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let chunk: {
          choices?: Array<{
            delta?: { content?: string | null; tool_calls?: DeltaToolCall[] };
            finish_reason?: string | null;
          }>;
          usage?: Usage | null;
        };
        try {
          chunk = JSON.parse(payload);
        } catch {
          // Побитий шматок — пропускаємо: обірвана відповідь краща за виняток.
          continue;
        }

        if (chunk.usage) usage = chunk.usage;

        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const text = choice.delta?.content;
        if (text) {
          content += text;
          opts.onDelta?.(text);
        }

        for (const frag of choice.delta?.tool_calls ?? []) {
          const slot = calls.get(frag.index) ?? { id: "", name: "", args: "" };
          if (frag.id) slot.id = frag.id;
          if (frag.function?.name) slot.name = frag.function.name;
          if (frag.function?.arguments) slot.args += frag.function.arguments;
          calls.set(frag.index, slot);
        }
      }
    }
  }

  const toolCalls: ToolCall[] = [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, c]) => c.name)
    .map(([index, c]) => ({
      // id зазвичай приходить, але бачили відповіді без нього — тоді
      // складаємо свій: головне, щоб він збігався в assistant-повідомленні
      // й у відповіді інструмента, інакше API поверне 400.
      id: c.id || `call_${index}`,
      type: "function" as const,
      function: { name: c.name, arguments: c.args || "{}" },
    }));

  return { content, toolCalls, finishReason, usage };
}
