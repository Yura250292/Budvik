/**
 * Коли наступне ТО: «масло кожні 10 000 км або 12 місяців» — що настане раніше.
 *
 * Відлік — від останнього запису того самого виду. Запису немає — стан
 * «unknown», а не «прострочено»: машину могли купити з щойно заміненим
 * маслом, і червоний бейдж на кожній новій машині вчив би його ігнорувати.
 *
 * «Скоро» — коли лишилось ≤ 10 % інтервалу (але не менше 1000 км) або
 * ≤ 30 днів: за цей час встигають записатися на СТО.
 */

export type DueState = "ok" | "soon" | "overdue" | "unknown";

export type DueInput = {
  everyKm: number | null;
  everyMonths: number | null;
  last: { day: string; odometerKm: number | null } | null;
  /** Поточний пробіг машини; null — невідомий. */
  odometerKm: number | null;
  today: string;
};

export type Due = {
  state: DueState;
  /** Пробіг, на якому треба міняти */
  dueAtKm: number | null;
  kmLeft: number | null;
  /** Дата, до якої треба міняти */
  dueDay: string | null;
  daysLeft: number | null;
};

const SOON_DAYS = 30;
const SOON_KM_MIN = 1000;

export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  // 31 січня + 1 міс. → 28/29 лютого, а не 3 березня.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function serviceDue(input: DueInput): Due {
  const { everyKm, everyMonths, last, odometerKm, today } = input;
  const none: Due = { state: "unknown", dueAtKm: null, kmLeft: null, dueDay: null, daysLeft: null };
  if (!last) return none;

  const dueAtKm = everyKm && last.odometerKm != null ? last.odometerKm + everyKm : null;
  const kmLeft = dueAtKm != null && odometerKm != null ? dueAtKm - odometerKm : null;
  const dueDay = everyMonths ? addMonths(last.day, everyMonths) : null;
  const daysLeft = dueDay ? daysBetween(today, dueDay) : null;

  if (kmLeft == null && daysLeft == null) return { ...none, dueAtKm, dueDay };

  const kmSoon = everyKm ? Math.max(SOON_KM_MIN, everyKm * 0.1) : 0;
  let state: DueState = "ok";
  if ((kmLeft != null && kmLeft <= 0) || (daysLeft != null && daysLeft <= 0)) state = "overdue";
  else if ((kmLeft != null && kmLeft <= kmSoon) || (daysLeft != null && daysLeft <= SOON_DAYS)) state = "soon";

  return { state, dueAtKm, kmLeft, dueDay, daysLeft };
}

/** Порядок важливості: прострочене зверху. */
export const DUE_RANK: Record<DueState, number> = { overdue: 0, soon: 1, unknown: 2, ok: 3 };

export const DUE_LABEL: Record<DueState, string> = {
  overdue: "прострочено",
  soon: "скоро",
  unknown: "немає відліку",
  ok: "гаразд",
};
