/**
 * Дріт до моделі: один запит зі стрімом і накопиченням викликів інструментів.
 *
 * Дві моделі, один формат. DeepSeek і Gemini (через OpenAI-сумісний вхід
 * Google) говорять тим самим протоколом chat/completions, тож цикл ходу,
 * інструменти й історія не знають, хто відповідає. Відмінності живуть лише
 * тут, і їх рівно чотири:
 *
 *   1. Думання. DeepSeek вмикає його полем `thinking` і вимагає повертати
 *      `reasoning_content`; Gemini — полем `reasoning_effort`, а думку
 *      тримає в підписі виклику.
 *   2. Підпис думки. Gemini кладе `extra_content.google.thought_signature` у
 *      кожен виклик інструмента й чекає його назад у наступному раунді.
 *      DeepSeek такого поля не знає — йому його не шлемо.
 *   3. Фрагменти викликів. DeepSeek віддає `index`; Gemini — ні, зате
 *      приносить виклик одним шматком з `id`.
 *   4. Температура. DeepSeek отримує 0.3; Gemini 3 Google радить лишати
 *      типовою — нижча погіршує міркування.
 *
 * Без SDK, звичайним fetch: потрібні три поля з відповіді, а не клієнтська
 * бібліотека з власним життєвим циклом.
 *
 * Стрім тут не заради краси. Хід із інструментами триває десятки секунд, і
 * без потоку користувач стільки дивиться в порожній екран, а з'єднання
 * ризикує впасти по таймауту проксі.
 */

import { TEMPERATURE, providerFor, type Effort, type LlmFlavor } from "@/lib/assistant/config";
import type { ChatMessage, ToolCall, ToolSchema, Usage } from "@/lib/assistant/types";

/**
 * Відмова моделі.
 *
 * `status` — те, що побачить людина (429 — «забагато запитів», 504 — «не
 * встигла», решта — 502). `upstream` — що насправді відповів провайдер: за
 * ним цикл ходу вирішує, чи варто повторювати. `retryable` — лише швидкі
 * тимчасові відмови (429, 5xx); таймаут повторювати марно, його лікує
 * запасна модель.
 */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly upstream: number | "timeout" | "network" | "stream" = status,
    readonly retryable = false,
    /**
     * Вичерпана квота провайдера: "day" — денна, "minute" — хвилинна.
     *
     * Окремо від звичайного 429, бо лікується інакше: повтор марний, а
     * наступні ходи мають одразу йти до запасної моделі, не палячи на
     * кожному запит, що гарантовано впаде (див. model-health.ts).
     */
    readonly quota: "day" | "minute" | null = null
  ) {
    super(message);
  }
}

export type ChatResult = {
  content: string;
  /**
   * Міркування DeepSeek — окремим полем, не в `content`.
   *
   * Користувачеві вони не показуються: у стрім іде лише `content`. Потрібні
   * для двох речей — повернути їх моделі наступним раундом і побачити в
   * журналі, скільки вона думала. У Gemini завжди порожні.
   */
  reasoning: string;
  toolCalls: ToolCall[];
  /** "tool_calls" | "stop" | "length" — від нього залежить, що робити далі. */
  finishReason: string;
  usage: Usage | null;
  model: string;
};

type DeltaToolCall = {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  extra_content?: Record<string, unknown>;
};

/**
 * Повідомлення в тому вигляді, який розуміє саме цей провайдер.
 *
 * Історія ходу спільна для обох: після переходу на запасну модель у ній
 * уже лежать виклики з підписами Gemini, а в режимі думання DeepSeek —
 * `reasoning_content`. Кожне поле йде лише туди, де його знають.
 */
function wireMessages(messages: ChatMessage[], flavor: LlmFlavor): unknown[] {
  return messages.map((m) => {
    if (m.role !== "assistant") return m;
    const { reasoning_content, tool_calls, ...rest } = m;
    const calls = tool_calls?.map((c) => (flavor === "gemini" ? c : stripSignature(c)));
    return {
      ...rest,
      ...(calls && calls.length > 0 ? { tool_calls: calls } : {}),
      ...(flavor === "deepseek" && reasoning_content ? { reasoning_content } : {}),
    };
  });
}

/** Виклик без підпису Gemini — для бази й для DeepSeek. */
export function stripSignature(call: ToolCall): ToolCall {
  if (!call.extra_content) return call;
  return { id: call.id, type: call.type, function: call.function };
}

/**
 * Текст помилки провайдера.
 *
 * Google загортає тіло помилки в МАСИВ (`[{"error": {...}}]`), DeepSeek — ні.
 * Людині показуємо не це, але в журнал має потрапити зрозуміла причина, а не
 * «[object Object]».
 */
function errorDetail(raw: string): { message: string; quota: "day" | "minute" | null } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const error = (first as {
      error?: { message?: string; details?: Array<{ violations?: Array<{ quotaId?: string }> }> };
    })?.error;
    if (error?.message) {
      /**
       * Квота Google лежить у details → QuotaFailure → quotaId, напр.
       * «GenerateRequestsPerDayPerProjectPerModel-FreeTier». Перевірено
       * 16.09.2026: ключ проєкту на безкоштовному тарифі, 20 запитів на
       * добу на модель — і відповідь 429 саме з таким quotaId.
       */
      const ids = (error.details ?? []).flatMap((d) => d.violations ?? []).map((v) => v.quotaId ?? "");
      const quota = ids.some((id) => /PerDay/i.test(id))
        ? "day"
        : ids.some((id) => /PerMinute/i.test(id))
          ? "minute"
          : null;
      return { message: error.message.split("\n")[0], quota };
    }
  } catch {
    // не JSON — віддаємо як є
  }
  return { message: raw.replace(/\s+/g, " ").slice(0, 400), quota: null };
}

export async function streamChat(opts: {
  model: string;
  apiKey: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  /** "none" — заборонити інструменти й вимагати текст. */
  toolChoice: "auto" | "none";
  maxTokens: number;
  /**
   * Скільки думати перед відповіддю. Вирішує цикл ходу, а не цей файл.
   *
   * DeepSeek: `thinking` вмикає роздум, `reasoning_effort` задає глибину
   * (проба 23.09.2026: low 1,3 тис. токенів роздуму, high 3,1, max 4,6).
   * Проба 11.09.2026 підтвердила, що в режимі міркувань працюють і
   * інструменти зі стрімом, і `tool_choice: "none"`, а `temperature` мовчки
   * не діє.
   *
   * Gemini: `reasoning_effort`. «off» лишається `low`, як було з 16.09:
   * `none` у 3.6 справді вимикає думку, але з інструментами й підписами
   * думки його бойовим прогоном не перевіряли. Вище `high` у Gemini рівня
   * немає — «max» іде як `high`.
   */
  effort: Effort;
  /** Стеля на весь виклик — цикл ходу рахує її від дедлайну. */
  timeoutMs: number;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
}): Promise<ChatResult> {
  const provider = providerFor(opts.model);
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: wireMessages(opts.messages, provider.flavor),
    /**
     * Інструменти надсилаємо ЗАВЖДИ, а забороняємо їх через
     * tool_choice: "none".
     *
     * Спокуса прибрати їх зі списку на останньому раунді дорого
     * коштувала: історія розмови вже містить виклики інструментів, і
     * DeepSeek, не побачивши їх у запиті, віддала СЛУЖБОВУ РОЗМІТКУ
     * виклику як звичайний текст — користувач отримав у відповідь
     * шматок внутрішнього формату. З явним "none" вона знає, що
     * інструменти є, але цього разу не її черга ними користуватись.
     */
    ...(opts.tools.length > 0 ? { tools: opts.tools, tool_choice: opts.toolChoice } : {}),
    max_tokens: opts.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (provider.flavor === "deepseek") {
    body.temperature = TEMPERATURE;
    /**
     * Міркування вимкнені за замовчуванням, і це рішення, а не недогляд.
     *
     * У DeepSeek режим міркувань увімкнений САМ, якщо поля немає. Для
     * «обрати інструмент і переказати готові числа» це марна витрата
     * секунд і токенів, тож помічник торгового, водія й складовщика
     * просить вимкнути.
     */
    body.thinking = { type: opts.effort === "off" ? "disabled" : "enabled" };
    if (opts.effort !== "off") body.reasoning_effort = opts.effort;
  } else {
    body.reasoning_effort = opts.effort === "off" ? "low" : opts.effort === "max" ? "high" : opts.effort;
  }

  let res: Response;
  try {
    res = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    const timedOut = (e as Error).name === "TimeoutError" || timeout.aborted;
    throw new LlmError(
      timedOut ? `Модель ${provider.label} не відповіла вчасно` : `Модель ${provider.label} недоступна`,
      504,
      timedOut ? "timeout" : "network",
      !timedOut
    );
  }

  if (!res.ok || !res.body) {
    const detail = errorDetail(await res.text().catch(() => ""));
    console.error(`[assistant] ${provider.flavor} ${opts.model}`, res.status, detail.message, detail.quota ?? "");
    // Вичерпану квоту не повторюємо: другий запит упаде так само.
    const retryable = !detail.quota && (res.status === 429 || res.status >= 500);
    throw new LlmError(
      detail.quota
        ? `${provider.label}: вичерпано ${detail.quota === "day" ? "денну" : "хвилинну"} квоту`
        : res.status === 429
          ? `${provider.label}: забагато запитів`
          : `Помилка моделі ${provider.label} (${res.status})`,
      res.status === 429 ? 429 : 502,
      res.status,
      retryable,
      detail.quota
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";
  let content = "";
  let reasoning = "";
  let finishReason = "stop";
  let usage: Usage | null = null;
  let answeredBy = opts.model;

  /**
   * Склеювання викликів.
   *
   * DeepSeek віддає фрагменти шматками й склеювати треба ЗА index, а не за
   * порядком надходження: у першому фрагменті приходять id та ім'я, у
   * наступних — по кілька символів arguments, і фрагменти різних викликів
   * чергуються.
   *
   * Gemini index не шле зовсім, зате кожен виклик приходить цілим і з id.
   * Тому правило без index таке: фрагмент з id відкриває новий виклик,
   * фрагмент без id дописується в останній.
   */
  const slots: Array<{ id: string; name: string; args: string; extra?: Record<string, unknown> }> = [];
  const byIndex = new Map<number, (typeof slots)[number]>();

  try {
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
            model?: string;
            choices?: Array<{
              delta?: {
                content?: string | null;
                reasoning_content?: string | null;
                tool_calls?: DeltaToolCall[];
              };
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

          // Gemini кладе usage у КОЖЕН чанк наростаючим підсумком, DeepSeek —
          // в останній. Беремо останній побачений: в обох випадках це підсумок.
          if (chunk.usage) usage = chunk.usage;
          if (chunk.model) answeredBy = chunk.model;

          const choice = chunk.choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) finishReason = choice.finish_reason;

          const text = choice.delta?.content;
          if (text) {
            content += text;
            opts.onDelta?.(text);
          }

          /**
           * Міркування збираємо, але В СТРІМ НЕ ВІДДАЄМО.
           *
           * Воно приходить окремим полем і раніше за відповідь, тож спокуса
           * показати його «щоб не чекали порожнього екрана» велика. Не
           * показуємо: це чернетка думки, у якій модель вільно називає
           * припущення, що не потрапили у відповідь, — а торговий цитує
           * помічника клієнтові. Поки воно триває, інтерфейс показує «Думаю…».
           */
          const thought = choice.delta?.reasoning_content;
          if (thought) reasoning += thought;

          for (const frag of choice.delta?.tool_calls ?? []) {
            let slot = typeof frag.index === "number" ? byIndex.get(frag.index) : undefined;
            if (!slot && typeof frag.index !== "number" && !frag.id) slot = slots[slots.length - 1];
            if (!slot) {
              slot = { id: "", name: "", args: "" };
              slots.push(slot);
              if (typeof frag.index === "number") byIndex.set(frag.index, slot);
            }
            if (frag.id) slot.id = frag.id;
            if (frag.function?.name) slot.name = frag.function.name;
            if (frag.function?.arguments) slot.args += frag.function.arguments;
            if (frag.extra_content) slot.extra = frag.extra_content;
          }
        }
      }
    }
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    const timedOut = timeout.aborted;
    throw new LlmError(
      timedOut ? `Модель ${provider.label} не встигла дописати відповідь` : `Обрив відповіді ${provider.label}`,
      504,
      timedOut ? "timeout" : "stream",
      false
    );
  }

  const toolCalls: ToolCall[] = slots
    .map((c, position) => ({ c, position }))
    .filter(({ c }) => c.name)
    .map(({ c, position }) => ({
      // id зазвичай приходить, але бачили відповіді без нього — тоді
      // складаємо свій: головне, щоб він збігався в assistant-повідомленні
      // й у відповіді інструмента, інакше API поверне 400.
      id: c.id || `call_${position}`,
      type: "function" as const,
      function: { name: c.name, arguments: c.args || "{}" },
      ...(c.extra ? { extra_content: c.extra } : {}),
    }));

  if (usage && usage.prompt_cache_hit_tokens == null && usage.prompt_tokens_details?.cached_tokens != null) {
    usage = { ...usage, prompt_cache_hit_tokens: usage.prompt_tokens_details.cached_tokens };
  }

  /**
   * Токени думки Gemini — поза completion_tokens.
   *
   * Проба 16.09.2026: prompt 112 + completion 30 при total 313 — решта 171
   * і є думка. Платиться вона як вихід, тож додаємо її до completion і
   * кладемо в reasoning_tokens — так само, як їх рахує DeepSeek, щоб
   * лічильники й звіт про вартість не брехали вп'ятеро.
   */
  if (usage && provider.flavor === "gemini" && usage.total_tokens != null) {
    const thoughts = usage.total_tokens - usage.prompt_tokens - usage.completion_tokens;
    if (thoughts > 0 && usage.completion_tokens_details?.reasoning_tokens == null) {
      usage = {
        ...usage,
        completion_tokens: usage.completion_tokens + thoughts,
        completion_tokens_details: { ...usage.completion_tokens_details, reasoning_tokens: thoughts },
      };
    }
  }

  return { content, reasoning, toolCalls, finishReason, usage, model: answeredBy };
}
