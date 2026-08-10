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

/** Скільки днів борг вважається робочим. Два тижні від відвантаження. */
export const GRACE_DAYS = 14;

/** Межі кошиків у днях прострочення. */
const BUCKET_DAYS: { bucket: ReceivableBucket; maxDays: number | null }[] = [
  { bucket: "OVERDUE_30", maxDays: 30 },
  { bucket: "OVERDUE_60", maxDays: 60 },
  { bucket: "OVERDUE_90", maxDays: 90 },
  { bucket: "OVERDUE_90_PLUS", maxDays: null },
];

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

export interface AgingInput {
  /** Непогашений залишок */
  amount: number;
  /** Дата виставлення рахунка — від неї відлічується вік боргу */
  issuedAt: Date;
}

export interface AgingResult {
  total: number;
  current: number;
  overdue: number;
  /** Частка простроченої, 0..100 */
  overdueRatio: number;
  buckets: Record<ReceivableBucket, number>;
}

/** Скільки днів борг протермінований: вік мінус два тижні відстрочки. */
export function overdueDaysFor(issuedAt: Date, now: Date = new Date()): number {
  const ageDays = Math.floor((now.getTime() - issuedAt.getTime()) / 86_400_000);
  return Math.max(0, ageDays - GRACE_DAYS);
}

/**
 * Кошик для одного боргу.
 *
 * Перші два тижні борг робочий — це нормальний цикл розрахунків, а не
 * порушення. Далі кошики рахують саме дні ПОНАД відстрочку: борг віком
 * 20 днів прострочений на 6, а не на 20.
 */
export function bucketFor(issuedAt: Date, now: Date = new Date()): ReceivableBucket {
  const overdueDays = overdueDaysFor(issuedAt, now);
  if (overdueDays <= 0) return "CURRENT";

  for (const { bucket, maxDays } of BUCKET_DAYS) {
    if (maxDays == null || overdueDays <= maxDays) return bucket;
  }
  return "OVERDUE_90_PLUS";
}

/** Зводить перелік боргів у структуру старіння. */
export function calculateAging(items: AgingInput[], now: Date = new Date()): AgingResult {
  const buckets: Record<ReceivableBucket, number> = {
    CURRENT: 0,
    OVERDUE_30: 0,
    OVERDUE_60: 0,
    OVERDUE_90: 0,
    OVERDUE_90_PLUS: 0,
  };

  let total = 0;
  for (const item of items) {
    if (item.amount <= 0) continue;
    buckets[bucketFor(item.issuedAt, now)] += item.amount;
    total += item.amount;
  }

  const current = buckets.CURRENT;
  const overdue = total - current;

  return {
    total,
    current,
    overdue,
    overdueRatio: total > 0 ? (overdue / total) * 100 : 0,
    buckets,
  };
}
