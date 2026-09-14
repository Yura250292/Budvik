"use client";

/** Запити сторінок нарад і задач: помилка сервера стає Error з його текстом. */

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Помилка ${res.status}`);
  return data as T;
}

export async function sendJson<T>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Помилка ${res.status}`);
  return data as T;
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
