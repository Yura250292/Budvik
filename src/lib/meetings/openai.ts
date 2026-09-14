/**
 * Підсумок наради — OpenAI chat completions зі строгою JSON-схемою.
 *
 * Модель та сама, що в Metrum (gpt-4o, підписка оплачена), зі змінною
 * OPENAI_MEETING_MODEL на випадок заміни. Звичайний fetch без SDK, як решта
 * викликів моделей у проєкті.
 *
 * Строга схема гарантує форму відповіді, але не повноту: при finish_reason
 * "length" JSON обірваний. Перевіряємо це ДО розбору — інакше обрізаний
 * підсумок тихо виглядав би як «нарада без задач» (ті самі граблі, що в
 * src/lib/ai/insights.ts з max_tokens).
 *
 * Модуль без next/* — його збирає воркер.
 */

import { ProviderError, asProviderError, classifyHttp } from "./errors";

const URL = "https://api.openai.com/v1/chat/completions";
const SERVICE = "OpenAI";
export const DEFAULT_MEETING_MODEL = "gpt-4o";

export function meetingModel(): string {
  return process.env.OPENAI_MEETING_MODEL || DEFAULT_MEETING_MODEL;
}

export function openaiConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/** Відповідь обірвалась на ліміті токенів — наступна спроба просить стислішу. */
export class TruncatedError extends ProviderError {
  constructor() {
    super("Підсумок обірвався на півслові — нарада задовга для однієї відповіді", "retry");
    this.name = "TruncatedError";
  }
}

type ChatResponse = {
  model?: string;
  choices?: {
    finish_reason?: string;
    message?: { content?: string | null; refusal?: string | null };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

export async function chatJson(input: {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
  timeoutMs?: number;
}): Promise<{ parsed: unknown; model: string; promptTokens: number; completionTokens: number }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ProviderError("OPENAI_API_KEY не задано", "fatal");
  const model = meetingModel();

  let res: Response;
  try {
    res = await fetch(URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: input.temperature,
        max_completion_tokens: input.maxTokens,
        response_format: {
          type: "json_schema",
          json_schema: { name: input.schemaName, strict: true, schema: input.schema },
        },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 180_000),
    });
  } catch (e) {
    throw asProviderError(e, SERVICE);
  }

  const data = (await res.json().catch(() => null)) as ChatResponse | null;
  if (!res.ok) {
    const message = data?.error?.message || `HTTP ${res.status}`;
    throw new ProviderError(`${SERVICE}: ${message}`, classifyHttp(res.status, message), res.status);
  }

  const choice = data?.choices?.[0];
  if (!choice?.message) throw new ProviderError(`${SERVICE}: порожня відповідь`, "retry");
  if (choice.message.refusal) {
    throw new ProviderError(`${SERVICE}: модель відмовилась — ${choice.message.refusal}`, "fatal");
  }
  if (choice.finish_reason === "length") throw new TruncatedError();
  if (choice.finish_reason === "content_filter") {
    throw new ProviderError(`${SERVICE}: відповідь зупинив фільтр вмісту`, "fatal");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(choice.message.content ?? "");
  } catch {
    throw new ProviderError(`${SERVICE}: відповідь не є JSON`, "retry");
  }

  return {
    parsed,
    model: data?.model ?? model,
    promptTokens: data?.usage?.prompt_tokens ?? 0,
    completionTokens: data?.usage?.completion_tokens ?? 0,
  };
}
