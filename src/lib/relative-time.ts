/**
 * «2 години тому» українською.
 *
 * Intl.RelativeTimeFormat, а не власні відмінки: правил множини в українській
 * три (1 година / 2 години / 5 годин), і ручна таблиця однаково їх наплутає.
 */
const rtf = new Intl.RelativeTimeFormat("uk", { numeric: "auto" });

const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
  ["month", 12],
];

export function timeAgo(date: Date | string): string {
  const then = new Date(date).getTime();
  let value = (then - Date.now()) / 1000;

  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
    value /= size;
  }
  return rtf.format(Math.round(value), "year");
}

/** Скільки годин минуло — для порогів «замовлення чекає надто довго». */
export function hoursSince(date: Date | string): number {
  return (Date.now() - new Date(date).getTime()) / 3_600_000;
}

/** Коротко: «5 год», «2 дн» — для колонки очікування. */
export function shortWait(date: Date | string): string {
  const h = hoursSince(date);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} хв`;
  if (h < 24) return `${Math.round(h)} год`;
  return `${Math.round(h / 24)} дн`;
}
