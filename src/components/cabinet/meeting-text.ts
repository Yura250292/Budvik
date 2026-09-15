/**
 * Дрібниці для сторінок нарад у кабінеті: підпис дати й читання API.
 */

const DAY = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "numeric", month: "long" });
const TIME = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });

/** «15 вересня, 10:30 · 42 хв». */
export function meetingWhen(recordedAt: string, durationMs: number | null): string {
  const d = new Date(recordedAt);
  const parts = [`${DAY.format(d)}, ${TIME.format(d)}`];
  if (durationMs && durationMs >= 60_000) parts.push(`${Math.round(durationMs / 60_000)} хв`);
  return parts.join(" · ");
}

export async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const d = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
  return d as T;
}
