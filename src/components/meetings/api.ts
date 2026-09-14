"use client";

/** Запити сторінок нарад і задач: помилка сервера стає Error з його текстом. */

/**
 * Запит не дійшов до сервера або відповідь не повернулась.
 *
 * Окремий клас, бо тут дія інша, ніж на помилці сервера: запис на сторінці
 * цілий, і досить натиснути ще раз. Safari в такому разі пише «Load failed» —
 * людині це нічого не каже.
 */
export class NetworkError extends Error {
  constructor() {
    super("Зв'язок із сервером обірвався");
    this.name = "NetworkError";
  }
}

/**
 * fetch із повтором на обрив мережі.
 *
 * 14.09.2026 перша ж записана нарада не збереглась: POST створення не дійшов
 * до Vercel узагалі (у логах його немає), а Safari показав «з'єднання з
 * мережею втрачено». Так Safari поводиться, коли шле запит у з'єднання, яке
 * сервер уже закрив за простоєм, — GET він повторює сам, а POST ні. Під час
 * запису наради сторінка якраз довго мовчить.
 *
 * Повторюємо лише там, де виклик безпечний для повтору (retry): створення
 * наради має ідентифікатор від браузера, завершення завантаження ідемпотентне.
 */
async function fetchRetrying(url: string, init: RequestInit, retries: number): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch {
      if (attempt >= retries) throw new NetworkError();
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetchRetrying(url, { cache: "no-store" }, 1);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Помилка ${res.status}`);
  return data as T;
}

export async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
  opts: { retry?: boolean } = {}
): Promise<T> {
  const res = await fetchRetrying(
    url,
    {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    opts.retry ? 2 : 0
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Помилка ${res.status}`);
  return data as T;
}

/** Ідентифікатор нової наради, який браузер надсилає разом зі створенням. */
export function newClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

const KYIV = "Europe/Kyiv";

export function kyivDateTime(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    timeZone: KYIV,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** «пт, 18.09» — дедлайн. */
export function dueLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("uk-UA", { timeZone: KYIV, weekday: "short", day: "2-digit", month: "2-digit" });
}

/** ISO → «YYYY-MM-DD» за Києвом для <input type="date">. */
export function dateInputValue(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: KYIV }) : "";
}

export function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} МБ`;
}
