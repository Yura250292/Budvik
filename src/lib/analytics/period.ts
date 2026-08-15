/**
 * Період для аналітики торгових.
 *
 * Обидві сторінки-попередниці рахували період по-своєму: sales-analytics
 * брала `days` і naive `new Date()`, sales-reports — `from`/`to` з київськими
 * межами доби. Через це один і той самий «місяць» давав різні числа. Тут
 * єдине джерело правди: приймаємо обидва формати, віддаємо київські межі.
 */

import { kyivDate, kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { ANALYTICS_SINCE_DAY } from "@/lib/analytics/since";

export type Period = {
  /** YYYY-MM-DD за Києвом, включно */
  fromDay: string;
  toDay: string;
  /** Межі в UTC для порівняння з createdAt */
  from: Date;
  to: Date;
  /** Скільки календарних днів у періоді (включно) — для «в середньому за день» */
  days: number;
  /**
   * true, якщо початок періоду підтягнули до межі історії. Фронт показує
   * підпис, інакше обрізаний період мовчки читався б як «стільки й продали».
   */
  clamped: boolean;
};

const DAY_MS = 86_400_000;

/** YYYY-MM-DD, зсунута на n днів. */
export function shiftDay(day: string, deltaDays: number): string {
  return kyivDate(new Date(kyivDayStart(day).getTime() + deltaDays * DAY_MS));
}

/**
 * Розбирає ?from&to (пріоритет) або ?days= (сумісність зі старим фронтом).
 * `days=30` означає «сьогодні та 29 попередніх днів», а не «мінус 30 діб від
 * поточної миті» — інакше межа їздила б протягом дня.
 */
export function parsePeriod(params: URLSearchParams, defaultDays = 30): Period {
  const today = kyivDate(new Date());
  const fromParam = params.get("from");
  const toParam = params.get("to");

  let fromDay: string;
  let toDay: string;

  if (fromParam && toParam) {
    fromDay = fromParam;
    toDay = toParam;
    if (fromDay > toDay) [fromDay, toDay] = [toDay, fromDay];
  } else {
    const days = Math.min(365, Math.max(1, parseInt(params.get("days") ?? String(defaultDays), 10) || defaultDays));
    toDay = today;
    fromDay = shiftDay(today, -(days - 1));
  }

  // Початок підтягуємо до межі історії: раніше за неї лежать самі повернення
  // без реалізацій, і період віддав би від'ємний оборот. Робимо це тут, бо
  // parsePeriod — єдиний вхід для всієї аналітики; правити кожен роут окремо
  // означало б рано чи пізно забути один і повернути мінуси назад.
  const clamped = fromDay < ANALYTICS_SINCE_DAY;
  if (clamped) fromDay = ANALYTICS_SINCE_DAY;

  const from = kyivDayStart(fromDay);
  const to = kyivDayEnd(toDay);

  return {
    fromDay,
    toDay,
    from,
    to,
    // days рахуємо ВЖЕ по обрізаному періоду: інакше «в середньому за день»
    // ділило б реальний оборот на дні, яких у вибірці немає.
    days: Math.max(1, Math.round((kyivDayStart(toDay).getTime() - from.getTime()) / DAY_MS) + 1),
    clamped,
  };
}

/** "2026-08" → київські межі місяця. Для планів (period = MONTH). */
export function parseMonth(month: string | null): { month: string; periodStart: Date; from: Date; to: Date } {
  const fallback = kyivDate(new Date()).slice(0, 7);
  const value = /^\d{4}-\d{2}$/.test(month ?? "") ? month! : fallback;

  const [y, m] = value.split("-").map(Number);
  const firstDay = `${value}-01`;
  // Останній день місяця: нульовий день наступного місяця
  const lastDate = new Date(Date.UTC(y, m, 0));
  const lastDay = `${value}-${String(lastDate.getUTCDate()).padStart(2, "0")}`;

  return {
    month: value,
    periodStart: kyivDayStart(firstDay),
    from: kyivDayStart(firstDay),
    to: kyivDayEnd(lastDay),
  };
}
