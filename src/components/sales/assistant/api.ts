"use client";

/** Типи й запити помічника — спільні для екрана й хука. */

export type ToolTrace = { name: string; label: string; ms: number | null };

export type UiMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
  tools: ToolTrace[];
  /** false — відповідь склав код без моделі. */
  viaModel?: boolean;
  /** Назва моделі, що відповіла; null — код або давня репліка. */
  model?: string | null;
  /** Що керівник уже сказав про цю відповідь; null — ще не оцінював. */
  feedback?: { verdict: "GOOD" | "BAD" | null; expected: string | null } | null;
  /** Локальні стани оптимістичного повідомлення. */
  pending?: boolean;
  failed?: boolean;
};

/** Присуд про відповідь помічника. */
export type Verdict = "GOOD" | "BAD";

/** Перемикач керівника: провайдер, а не назва моделі (див. config.ts). */
export type ModelChoice = "gemini" | "deepseek";

/** Рівень думання керівника — у підписі словами, а не none/low/high/max. */
const LEVEL_LABEL: Record<string, string> = {
  none: "швидко",
  low: "коротко подумав",
  high: "думав",
  max: "думав глибоко",
};

/**
 * «gemini-3.8-flash» → «Gemini 3.8 Flash» — для підпису під відповіддю.
 * З рівнем («gemini-3.6-flash·high», див. loop.ts) — «Gemini 3.6 Flash · думав».
 */
export function modelLabel(model: string): string {
  const [name, level] = model.split("·");
  const label = name
    .split("-")
    .map((part) => (part === "deepseek" ? "DeepSeek" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
  return level && LEVEL_LABEL[level] ? `${label} · ${LEVEL_LABEL[level]}` : label;
}

export type ThreadSummary = {
  id: string;
  title: string | null;
  repId: string;
  repName: string;
  lastMessageAt: string;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function jsonOrThrow(res: Response) {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error ?? "");
  return body;
}

export async function createThread(repId?: string | null): Promise<string> {
  const res = await fetch("/api/sales/assistant/threads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(repId ? { repId } : {}),
  });
  const body = await jsonOrThrow(res);
  return body.id as string;
}

export async function deleteThread(id: string): Promise<void> {
  const res = await fetch(`/api/sales/assistant/threads/${id}`, { method: "DELETE" });
  await jsonOrThrow(res);
}

/**
 * Оцінити відповідь.
 *
 * Знімок ходу (питання, інструменти, токени) збирає сервер сам — звідси
 * летить лише id репліки й присуд.
 */
export async function sendVerdict(messageId: string, verdict: Verdict, expected?: string): Promise<void> {
  const res = await fetch("/api/sales/assistant/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(expected ? { messageId, verdict, expected } : { messageId, verdict }),
  });
  await jsonOrThrow(res);
}

/** Дописати «як мало бути» після того, як 👎 уже поставлено. */
export async function sendExpected(messageId: string, expected: string): Promise<void> {
  const res = await fetch("/api/sales/assistant/feedback", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, expected }),
  });
  await jsonOrThrow(res);
}

/** Зняти оцінку — натиснув не ту кнопку. */
export async function dropVerdict(messageId: string): Promise<void> {
  const res = await fetch(`/api/sales/assistant/feedback?messageId=${encodeURIComponent(messageId)}`, {
    method: "DELETE",
  });
  await jsonOrThrow(res);
}
