/**
 * Які сторінки кабінету вже переписані нативно.
 *
 * Кабінет переїжджає у натив по одному екрану за реліз, а решта далі
 * відкривається як сайт у WebView. Ця таблиця — єдине місце, де записано, що
 * саме вже переїхало: додав екран — додав рядок, і посилання на сайті починає
 * вести в нативний екран без жодної правки на боці сайту.
 *
 * Чому перехоплення, а не окрема навігація в застосунку: у кабінеті на ці
 * сторінки ведуть десятки посилань — з таб-бару, з карток, із листа маршруту.
 * Переписувати їх усі означало б розсинхронізувати сайт і застосунок на першій
 * же правці меню.
 */

import { API_BASE } from "@/api/client";

/** Шлях на сайті → маршрут у застосунку. */
const NATIVE_ROUTES: Array<[RegExp, "/day"]> = [
  // День водія: список точок, відмітки, каса. Головне, що дає натив, —
  // відмітка візиту без зв'язку.
  [/^\/driver\/tablet\/?$/, "/day"],
];

export function nativeRouteFor(url: string): string | null {
  if (!url.startsWith(API_BASE)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  for (const [pattern, route] of NATIVE_ROUTES) {
    if (!pattern.test(parsed.pathname)) continue;

    /**
     * Параметри несемо з собою.
     *
     * Без них нативний екран показував би СЬОГОДНІШНІЙ день на будь-яке
     * посилання — тобто водій, відкривши вчорашній лист, бачив би чужі
     * точки під його номером і не помітив би підміни.
     */
    const route_ = parsed.searchParams.get("route");
    const day = parsed.searchParams.get("day");
    if (route_) return `${route}?route=${encodeURIComponent(route_)}`;
    if (day) return `${route}?day=${encodeURIComponent(day)}`;
    return route;
  }
  return null;
}
