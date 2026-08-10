/**
 * Старіння дебіторки: робоча vs прострочена.
 *
 * З наради: «Стан загальної дебіторки, стан робочої, стан простроченої.
 * У кого найменше відсоток простроченої — той має премію».
 *
 * Вік боргу рахується від дати відвантаження і проходить два етапи, які
 * відповідають реальному циклу: торговий узяв замовлення → водій везе
 * товар (перші дні) → гроші забирають наступною поїздкою. Тому борг
 * стає простроченим лише після повного циклу, а не одразу після
 * відвантаження: карати за нормальний хід справ безглуздо.
 *
 * Строки 1С не віддає — розбивку рахуємо самі за датами наших
 * документів реалізації.
 */

import type { ReceivableBucket } from "@prisma/client";

/** Скільки днів товар типово їде до клієнта. Доти оплати ще не чекаємо. */
export const DELIVERY_DAYS = 3;

/**
 * Скільки днів борг лишається робочим від дати відвантаження.
 *
 * 15 днів = доставка + час на реалізацію: клієнт продає товар і віддає
 * гроші, коли торговий приїде наступного разу.
 */
export const GRACE_DAYS = 15;

export const BUCKET_LABELS: Record<ReceivableBucket, string> = {
  CURRENT: `Робоча (до ${GRACE_DAYS} дн.)`,
  OVERDUE_30: "До 30 днів",
  OVERDUE_60: "31–60 днів",
  OVERDUE_90: "61–90 днів",
  OVERDUE_90_PLUS: "Понад 90 днів",
};

/**
 * Етап життя робочого боргу — усередині GRACE_DAYS.
 *
 * Розділяє «товар ще їде» і «товар у клієнта, чекаємо гроші»: у першому
 * випадку питати з торгового нема про що, у другому — вже є.
 */
export type WorkingStage = "DELIVERY" | "AWAITING_PAYMENT";

export const STAGE_LABELS: Record<WorkingStage, string> = {
  DELIVERY: `Доставка (0–${DELIVERY_DAYS} дн.)`,
  AWAITING_PAYMENT: `Очікування оплати (${DELIVERY_DAYS}–${GRACE_DAYS} дн.)`,
};

export const STAGE_COLORS: Record<WorkingStage, string> = {
  DELIVERY: "#3B82F6",
  AWAITING_PAYMENT: "#16A34A",
};

/** Кошик боргу за віком у днях від відвантаження. */
export function bucketForAge(ageDays: number): ReceivableBucket {
  if (ageDays <= GRACE_DAYS) return "CURRENT";

  const overdueDays = ageDays - GRACE_DAYS;
  if (overdueDays <= 30) return "OVERDUE_30";
  if (overdueDays <= 60) return "OVERDUE_60";
  if (overdueDays <= 90) return "OVERDUE_90";
  return "OVERDUE_90_PLUS";
}

/** Етап робочого боргу; null — борг уже прострочений. */
export function stageForAge(ageDays: number): WorkingStage | null {
  if (ageDays > GRACE_DAYS) return null;
  return ageDays <= DELIVERY_DAYS ? "DELIVERY" : "AWAITING_PAYMENT";
}

export const BUCKET_COLORS: Record<ReceivableBucket, string> = {
  CURRENT: "#16A34A",
  OVERDUE_30: "#EAB308",
  OVERDUE_60: "#F97316",
  OVERDUE_90: "#DC2626",
  OVERDUE_90_PLUS: "#7F1D1D",
};

export interface AgingResult {
  total: number;
  /** Робоча дебіторка — до GRACE_DAYS від відвантаження */
  current: number;
  overdue: number;
  /** Частка простроченої, 0..100 */
  overdueRatio: number;
  buckets: Record<ReceivableBucket, number>;
  /** Розбивка робочої частини за етапами циклу */
  stages: Record<WorkingStage, number>;
  /**
   * Борг, вік якого встановити не вдалося: відвантажень під нього в базі
   * немає. Такий борг старший за нашу історію, тож вважається
   * простроченим понад 90 днів і входить у `overdue`.
   */
  unknown: number;
}

/**
 * Порожнє старіння — для торгового без дебіторки.
 *
 * Розбивку рахує 1С, а не ми: у базі є лише підсумкове сальдо по
 * клієнту, дат окремих накладних немає. Зведення готових кошиків —
 * `sumAging` у src/lib/analytics/money-facts.ts.
 */
export const EMPTY_AGING: AgingResult = {
  total: 0,
  current: 0,
  overdue: 0,
  overdueRatio: 0,
  buckets: { CURRENT: 0, OVERDUE_30: 0, OVERDUE_60: 0, OVERDUE_90: 0, OVERDUE_90_PLUS: 0 },
  stages: { DELIVERY: 0, AWAITING_PAYMENT: 0 },
  unknown: 0,
};
