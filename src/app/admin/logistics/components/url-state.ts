"use client";

/**
 * Стан сторінок «Логістики» в адресі.
 *
 * Кожна сторінка розділу — єдиний власник свого стану в URL, але спільний
 * період (?from=&to=) мусить переживати перемикання між сторінками: «Зміни за
 * серпень» → «Паливо» мають лишитися серпнем.
 */

import type { ReadonlyURLSearchParams } from "next/navigation";
import { kyivToday, type Period } from "@/components/ui/PeriodPicker";

/** Типовий період — з початку місяця по сьогодні, як і в решті адмінки. */
export function defaultPeriod(): Period {
  const today = kyivToday();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/** Період з ?from=&to= або типовий. */
export function periodFromParams(params: URLSearchParams | ReadonlyURLSearchParams): Period {
  const from = params.get("from");
  const to = params.get("to");
  return from && to ? { from, to } : defaultPeriod();
}

/**
 * Записує в адресу лише свої ключі, решту лишає як є.
 *
 * «Рух на карті» нічого не знає про період, і без цього, повертаючись у
 * «Зміни», людина губила б обраний місяць.
 *
 * replace, а не push: інакше кожна зміна фільтра лягала б в історію, і
 * «Назад» гортало б власні кліки. Кликати з ОДНОГО ефекту на сторінку:
 * два replace підряд читали б ще не оновлену адресу і затирали одне одного.
 */
export function replaceQuery(
  router: { replace: (href: string, options?: { scroll?: boolean }) => void },
  pathname: string,
  patch: Record<string, string | null>
): void {
  const next = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === "") next.delete(key);
    else next.set(key, value);
  }
  const qs = next.toString();
  const href = qs ? `${pathname}?${qs}` : pathname;
  if (href !== `${window.location.pathname}${window.location.search}`) {
    router.replace(href, { scroll: false });
  }
}
