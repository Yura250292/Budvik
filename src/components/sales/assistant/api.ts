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
  /** Локальні стани оптимістичного повідомлення. */
  pending?: boolean;
  failed?: boolean;
};

/** Перемикач керівника: провайдер, а не назва моделі (див. config.ts). */
export type ModelChoice = "gemini" | "deepseek";

/** «gemini-3.8-flash» → «Gemini 3.8 Flash» — для підпису під відповіддю. */
export function modelLabel(model: string): string {
  return model
    .split("-")
    .map((part) => (part === "deepseek" ? "DeepSeek" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
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
