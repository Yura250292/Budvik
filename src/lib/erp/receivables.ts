/**
 * Старіння дебіторки: робоча vs прострочена.
 *
 * З наради: «Стан загальної дебіторки, стан робочої, стан простроченої.
 * У кого найменше відсоток простроченої — той має премію».
 *
 * Правило одне для всіх: борг старший за GRACE_DAYS вважається
 * простроченим. Раніше рахувався індивідуальний `Invoice.dueDate`, але
 * він заповнений не всюди, і рахунки без нього висіли в «робочих»
 * скільки завгодно — борг піврічної давнини не потрапляв у прострочку
 * лише тому, що йому колись не проставили строк.
 */

import type { ReceivableBucket } from "@prisma/client";

/**
 * Скільки днів борг вважається робочим — два тижні від відвантаження.
 *
 * Саме цю межу має застосовувати звіт 1С, коли формує розбивку: у нас
 * дат окремих накладних немає, тож перевірити її на своєму боці нічим.
 */
export const GRACE_DAYS = 14;

export const BUCKET_LABELS: Record<ReceivableBucket, string> = {
  CURRENT: "Робоча (до 14 дн.)",
  OVERDUE_30: "До 30 днів",
  OVERDUE_60: "31–60 днів",
  OVERDUE_90: "61–90 днів",
  OVERDUE_90_PLUS: "Понад 90 днів",
};

export const BUCKET_COLORS: Record<ReceivableBucket, string> = {
  CURRENT: "#16A34A",
  OVERDUE_30: "#EAB308",
  OVERDUE_60: "#F97316",
  OVERDUE_90: "#DC2626",
  OVERDUE_90_PLUS: "#7F1D1D",
};

export interface AgingResult {
  total: number;
  current: number;
  overdue: number;
  /** Частка простроченої серед боргу з відомими строками, 0..100 */
  overdueRatio: number;
  buckets: Record<ReceivableBucket, number>;
  /**
   * Борг, для якого 1С ще не дала розбивку за строками. Не «робочий» і не
   * «прострочений» — просто невідомий, і саме так його треба показувати.
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
  unknown: 0,
};
