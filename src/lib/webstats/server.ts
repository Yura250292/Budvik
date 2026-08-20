/**
 * Серверний бік вебаналітики: те, що клієнту знати не обов'язково або
 * не варто йому довіряти.
 *
 * Пристрій, браузер і місто визначаємо тут, а не в браузері: так їх не
 * підробити саморобним запитом і не треба ганяти зайві байти в кожній
 * пачці.
 */

import type { WebstatsEventType } from "./client";

/** Типи подій, які ендпоінт узагалі приймає. Решта мовчки відкидається. */
export const EVENT_TYPES = new Set<WebstatsEventType>([
  "page_view",
  "product_view",
  "search",
  "add_to_cart",
  "add_to_wishlist",
  "add_to_compare",
  "order_placed",
  "phone_click",
]);

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|monitor|scrape|curl|wget|python-requests|axios|fetch\b/i;

export function isBotUserAgent(ua: string | null): boolean {
  if (!ua || ua.trim().length < 10) return true;
  return BOT_RE.test(ua);
}

/**
 * Мобільний чи ні.
 *
 * Навмисно грубо, у два значення: точна модель пристрою власнику
 * магазину нічого не дає, а «більшість заходить з телефона» — дає.
 */
export function parseDevice(ua: string | null): string {
  if (!ua) return "unknown";
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? "mobile" : "desktop";
}

/**
 * Браузер за User-Agent.
 *
 * Порядок перевірок важливий: Edge й Opera тримають у рядку слово
 * Chrome, а Chrome — слово Safari. Хто перевіряє Safari першим, отримує
 * сайт, де 90% відвідувачів «сафарі».
 */
export function parseBrowser(ua: string | null): string {
  if (!ua) return "інше";
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/SamsungBrowser/i.test(ua)) return "Samsung";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS/i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua)) return "Safari";
  return "інше";
}

/**
 * Країна й місто з заголовків Vercel.
 *
 * Місто приїжджає percent-encoded («Lviv» — ні, а «Ivano-Frankivsk» із
 * пробілами й кирилицею — так), тому декодуємо. Локально заголовків
 * немає — це нормально, поля просто лишаються порожні.
 */
export function parseGeo(headers: Headers): { country: string | null; city: string | null } {
  const country = headers.get("x-vercel-ip-country");
  const rawCity = headers.get("x-vercel-ip-city");
  let city: string | null = null;
  if (rawCity) {
    try {
      city = decodeURIComponent(rawCity);
    } catch {
      city = rawCity;
    }
  }
  return { country: country || null, city: city || null };
}

/** Обрізає рядок до межі й прибирає порожнечу. */
export function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Ціле в розумних межах — щоб у value не приїхало NaN чи 10^12. */
export function clampInt(value: unknown, max = 1_000_000): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(max, Math.round(n)));
}

/**
 * Хост реферера без www.
 *
 * Власнику цікаво «прийшли з google», а не повний URL із пошуковим
 * запитом і UTM-хвостом; заразом це менше персональних даних у базі.
 */
export function refererHost(value: unknown): string | null {
  const raw = clip(value, 300);
  if (!raw) return null;
  try {
    return new URL(raw).hostname.replace(/^www\./, "").slice(0, 120);
  } catch {
    return null;
  }
}
