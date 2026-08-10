"use client";

import { useSearchParams } from "next/navigation";
import type { ReceivableBucket } from "@prisma/client";
import { kyivToday, type Period } from "@/components/ui/PeriodPicker";
import { useApi } from "@/app/admin/sales-analytics/components/useApi";

/**
 * Дані кабінету торгового.
 *
 * Так, URL адмінський. Це не помилка й не тимчасово.
 *
 * /api/admin/sales-analytics/summary при role=SALES ігнорує параметр
 * repId і жорстко скоупить вибірку до session.user.id (scope: "own").
 * Тобто це не «адмінський ендпоінт, у який пустили торгового», а один
 * ендпоінт із двома режимами доступу.
 *
 * Копія під /api/sales/* дала б друге місце, де рахуються ті самі 11
 * показників — і перший же новий показник розійшовся б між кабінетом
 * торгового і зведеною керівника.
 */
const SUMMARY_URL = "/api/admin/sales-analytics/summary";
const PLAN_URL = "/api/sales/analytics/plan";
const RECEIVABLES_URL = "/api/admin/sales-analytics/receivables";

export type SummaryRow = {
  repId: string;
  repName: string;
  revenue: number;
  docs: number;
  clients: number;
  avgCheck: number;
  profit: number;
  plan: { target: number; actual: number; attainment: number };
  fuel: { cost: number; workKm: number; hasVehicle: boolean };
  collected: number;
  collectedProfit: number;
  receivables: {
    total: number;
    overdue: number;
    overdueRatio: number;
    buckets: Record<ReceivableBucket, number>;
    unknown: number;
  };
  earnings: null | { total: number; gross: number; penalties: number; schemeName: string };
  net: number;
};

export type SummaryResponse = {
  period: { from: string; to: string; days: number };
  month: string;
  receivablesAsOf: string;
  rows: SummaryRow[];
};

export type EarningLine = {
  ruleId: string;
  label: string;
  amount: number;
  explanation: string;
};

export type PlanBrand = {
  brandId: string;
  brandName: string;
  color: string;
  target: number;
  actual: number;
  attainment: number;
  qty: number;
  collected: number;
  /** null — за цією фірмою окремих правил у схемі немає */
  earned: number | null;
  earnedLines: EarningLine[];
};

export type PlanResponse = {
  period: { from: string; to: string; days: number };
  month: string;
  rep: { id: string; name: string };
  plan: { target: number; actual: number; attainment: number };
  brands: PlanBrand[];
  earnings: null | {
    schemeName: string;
    total: number;
    gross: number;
    penalties: number;
    byBrand: number;
    general: number;
    generalLines: EarningLine[];
    penaltyLines: EarningLine[];
  };
  reconciles: boolean;
};

export type ReceivablesResponse = {
  syncedAt: string | null;
  aging: {
    total: number;
    current: number;
    overdue: number;
    overdueRatio: number;
    buckets: Record<ReceivableBucket, number>;
    unknown: number;
  };
  clients: Array<{
    counterpartyId: string;
    name: string;
    code: string | null;
    debt: number;
    overdue: number | null;
    current: number | null;
    lastDocAt: string | null;
  }>;
};

export function defaultPeriod(): Period {
  const today = kyivToday();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

/**
 * Період із URL. Живе в query, а не в стані сторінки, щоб перехід у
 * дрілл і назад повертав той самий діапазон, а посилання можна було
 * переслати.
 */
export function usePeriodFromUrl(): Period {
  const params = useSearchParams();
  const from = params.get("from");
  const to = params.get("to");
  return from && to ? { from, to } : defaultPeriod();
}

/** Рядок зведеної для поточного торгового: сервер віддає рівно один. */
export function useMySummary(period: Period) {
  const { data, loading, error, reload } = useApi<SummaryResponse>(
    `${SUMMARY_URL}?from=${period.from}&to=${period.to}`
  );
  return { data, row: data?.rows?.[0] ?? null, loading, error, reload };
}

export function useMyPlan(period: Period) {
  return useApi<PlanResponse>(`${PLAN_URL}?from=${period.from}&to=${period.to}`);
}

/** repId не передаємо: для SALES сервер підставить власний. */
export function useMyReceivables(repId: string | null) {
  return useApi<ReceivablesResponse>(repId ? `${RECEIVABLES_URL}?repId=${repId}` : null);
}

/** Посилання, що переносить період у сусідній екран кабінету. */
export function withPeriod(href: string, period: Period): string {
  return `${href}?from=${period.from}&to=${period.to}`;
}

/**
 * Скільки днів лишилось до кінця місяця плану.
 *
 * Потрібне, щоб «лишилось 288 000 ₴» перетворити на дію: та сама сума
 * за 21 день і за 2 дні — різні новини.
 */
export function daysLeftInMonth(month: string): number {
  const today = kyivToday();
  if (today.slice(0, 7) !== month) return 0;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Math.max(0, lastDay - Number(today.slice(8, 10)));
}

const MONTHS = [
  "січень", "лютий", "березень", "квітень", "травень", "червень",
  "липень", "серпень", "вересень", "жовтень", "листопад", "грудень",
];

/** "2026-08" → "серпень 2026" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1] ?? month} ${y}`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}
