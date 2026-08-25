/**
 * Куди вести людину після входу — за її роллю.
 *
 * Одна відповідь на це питання потрібна двом різним входам: обміну
 * токена на сесію у WebView (`/api/device/session`) і входу в застосунок
 * (`/api/v1/auth/login`). Дві копії розійшлися б на першій новій ролі —
 * і хтось потрапляв би в чужий кабінет, що особливо погано виглядає в
 * застосунку, де адресного рядка немає й повернутися нікуди.
 */

import type { Role } from "@prisma/client";

/** Розділ сайту, який є домівкою для цієї ролі. */
export function defaultTargetFor(role: Role | string): string {
  switch (role) {
    case "DRIVER":
      return "/driver";
    case "SALES":
      return "/sales";
    case "ADMIN":
    case "MANAGER":
      return "/admin";
    case "WAREHOUSE":
      return "/warehouse";
    default:
      // Покупець у застосунку живе на нативних екранах, а на сайті — у
      // вітрині; сюди він потрапляє лише як запасний варіант.
      return "/";
  }
}

/**
 * Чи працює людина в компанії — на відміну від покупця.
 *
 * Від цього залежить, який контур застосунку їй відкривати: нативний
 * магазин чи робочий кабінет. Список навмисно окремий від областей
 * токенів: області кажуть, ЩО дозволено робити, а це — ЩО показати.
 */
export function isStaffRole(role: Role | string): boolean {
  return role === "DRIVER" || role === "SALES" || role === "ADMIN" || role === "MANAGER" || role === "WAREHOUSE";
}
