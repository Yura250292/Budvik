"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { useApi } from "@/components/ui/useApi";
import { kyivToday, type Period } from "@/components/ui/PeriodPicker";
import type { AdminRole } from "@/lib/admin-nav";

/**
 * Спільні дані дашборду.
 *
 * Віджети не ходять в API самостійно: більшість із них живиться з тих
 * самих трьох ендпоінтів, і десяток однакових запитів на одне
 * завантаження сторінки — це і зайве навантаження, і різні числа в
 * сусідніх картках, якщо відповіді розійдуться в часі.
 */

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
    buckets: Record<string, number>;
    stages: Record<string, number>;
    unknown: number;
  };
  earnings: null | { total: number; gross: number; penalties: number; schemeName: string };
  net: number;
};

export type SummaryResponse = {
  period: { from: string; to: string; days: number };
  month: string;
  scope: "all" | "single" | "own";
  rows: SummaryRow[];
  totals: {
    revenue: number;
    docs: number;
    clients: number;
    avgCheck: number;
    profit: number;
    plan: { target: number; actual: number; attainment: number };
    fuelCost: number;
    collected: number;
    receivableTotal: number;
    receivableOverdue: number;
    receivableUnknown: number;
    earnings: number;
    earningsCovered: number;
    net: number;
  };
  unattributed: { count: number; total: number };
};

export type OverviewResponse = {
  period: { days: number; from: string; to: string };
  totals: { docs: number; amount: number; average: number; sku: number; linesPerDoc: number };
  byRep: Array<{ id: string; name: string; docs: number; amount: number; sku: number }>;
  byBrand: Array<{ brand: string; color: string | null; qty: number; amount: number; docs: number }>;
  timeline: Array<{ day: string; docs: number; amount: number }>;
  topProducts: Array<{ name: string; sku: string; qty: number; amount: number }>;
  topClients: Array<{ name: string; docs: number; amount: number }>;
};

export type WarehouseResponse = {
  kpis: {
    totalReports: number;
    totalAmount: number;
    totalItems: number;
    activeWorkers: number;
    totalShifts: number;
    totalHours: number;
    pending: number;
    failed: number;
  };
  workers: Array<{
    id: string;
    name: string;
    totalHours: number;
    doneCount: number;
    failedCount: number;
    totalAmount: number;
    itemsCount: number;
    itemsPerHour: number;
    daysWorked: number;
    failRate: number;
    openShift: { openedAt: string; openAddress: string | null } | null;
  }>;
  daily: Array<{ date: string; reports: number; amount: number }>;
  hourly: Array<{ hour: number; reports: number }>;
  teamAvg: { itemsPerHour: number; itemsPerDay: number; reportsPerDay: number };
  nomenclature: Array<{ name: string; sku: string; quantity: number; totalSum: number; reportsCount: number }>;
};

type Source<T> = { data: T | null; loading: boolean; error: string | null };

type DashboardDataValue = {
  role: AdminRole;
  period: Period;
  setPeriod: (p: Period) => void;
  summary: Source<SummaryResponse>;
  overview: Source<OverviewResponse>;
  warehouse: Source<WarehouseResponse>;
  /** Чи взагалі варто питати склад: SALES туди не пускає middleware. */
  canSeeWarehouse: boolean;
};

const Ctx = createContext<DashboardDataValue | null>(null);

export function useDashboardData() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDashboardData must be used within DashboardDataProvider");
  return ctx;
}

function defaultPeriod(): Period {
  // Стартуємо з поточного місяця: план і мотивація рахуються місячні,
  // тож саме цей період збігається з тим, як на нього дивляться в житті.
  const today = kyivToday();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function DashboardDataProvider({
  role,
  children,
}: {
  role: AdminRole;
  children: React.ReactNode;
}) {
  const [period, setPeriod] = useState<Period>(defaultPeriod);
  const canSeeWarehouse = role === "ADMIN" || role === "MANAGER";

  const qs = `from=${period.from}&to=${period.to}`;
  const summary = useApi<SummaryResponse>(`/api/admin/sales-analytics/summary?${qs}`);
  const overview = useApi<OverviewResponse>(`/api/admin/sales-analytics?${qs}`);
  const warehouse = useApi<WarehouseResponse>(canSeeWarehouse ? `/api/admin/warehouse-reports?${qs}` : null);

  const value = useMemo<DashboardDataValue>(
    () => ({
      role,
      period,
      setPeriod,
      summary: { data: summary.data, loading: summary.loading, error: summary.error },
      overview: { data: overview.data, loading: overview.loading, error: overview.error },
      warehouse: { data: warehouse.data, loading: warehouse.loading, error: warehouse.error },
      canSeeWarehouse,
    }),
    [
      role,
      period,
      canSeeWarehouse,
      summary.data,
      summary.loading,
      summary.error,
      overview.data,
      overview.loading,
      overview.error,
      warehouse.data,
      warehouse.loading,
      warehouse.error,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
