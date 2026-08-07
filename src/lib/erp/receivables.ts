/**
 * Старіння дебіторки: робоча vs прострочена.
 *
 * З наради: «Стан загальної дебіторки, стан робочої, стан простроченої.
 * У кого найменше відсоток простроченої — той має премію».
 *
 * Наразі в системі `Invoice.dueDate` використовується лише для червоного
 * кольору тексту у звіті. Тут з нього робиться повноцінне старіння.
 */

import type { ReceivableBucket } from "@prisma/client";

/** Межі кошиків у днях прострочення. */
const BUCKET_DAYS: { bucket: ReceivableBucket; maxDays: number | null }[] = [
  { bucket: "OVERDUE_30", maxDays: 30 },
  { bucket: "OVERDUE_60", maxDays: 60 },
  { bucket: "OVERDUE_90", maxDays: 90 },
  { bucket: "OVERDUE_90_PLUS", maxDays: null },
];

export const BUCKET_LABELS: Record<ReceivableBucket, string> = {
  CURRENT: "Робоча",
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
  /** Строк оплати; null — вважаємо робочою (строк не встановлено) */
  dueDate: Date | null;
}

export interface AgingResult {
  total: number;
  current: number;
  overdue: number;
  /** Частка простроченої, 0..100 */
  overdueRatio: number;
  buckets: Record<ReceivableBucket, number>;
}

/**
 * Кошик для одного боргу.
 *
 * dueDate = null означає «строк не домовлений», і такий борг вважається
 * робочим. Позначати його простроченим було б несправедливо: торговий
 * не може закрити те, для чого немає дати.
 */
export function bucketFor(dueDate: Date | null, now: Date = new Date()): ReceivableBucket {
  if (!dueDate) return "CURRENT";

  const overdueDays = Math.floor((now.getTime() - dueDate.getTime()) / 86_400_000);
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
    buckets[bucketFor(item.dueDate, now)] += item.amount;
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
