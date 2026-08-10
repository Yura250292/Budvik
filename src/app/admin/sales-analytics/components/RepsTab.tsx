"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { ProgressBar, money, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useApi } from "./useApi";
import { ErrorBox } from "./ErrorBox";

/**
 * Рейтинг торгових: продажі, кілометраж і виконання плану в одному рядку.
 *
 * Саме тут видно те, заради чого зводилися дві сторінки: оборот поруч із
 * кілометражем відповідає на питання «скільки коштує ця виручка».
 */

type AnalyticsResponse = {
  byRep: Array<{ id: string; name: string; docs: number; amount: number }>;
};

type FuelResponse = {
  rows: Array<{
    repId: string;
    repName: string;
    totalKm: number;
    workKm: number;
    trips: number;
    daysWorked: number;
    cost: number;
  }>;
};

type AttainmentResponse = {
  rows: Array<{ repId: string; brandId: string | null; target: number; actual: number; attainment: number }>;
};

export function RepsTab({ period }: { period: Period }) {
  const router = useRouter();
  const month = period.to.slice(0, 7);

  const sales = useApi<AnalyticsResponse>(`/api/admin/sales-analytics?from=${period.from}&to=${period.to}`);
  const fuel = useApi<FuelResponse>(`/api/admin/sales-vehicles?from=${period.from}&to=${period.to}`);
  const plans = useApi<AttainmentResponse>(`/api/admin/sales-plans/attainment?month=${month}`);

  const rows = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; name: string; amount: number; docs: number; km: number; trips: number; days: number; fuelCost: number; attainment: number; target: number }
    >();

    for (const r of sales.data?.byRep ?? []) {
      byId.set(r.id, {
        id: r.id,
        name: r.name,
        amount: r.amount,
        docs: r.docs,
        km: 0,
        trips: 0,
        days: 0,
        fuelCost: 0,
        attainment: 0,
        target: 0,
      });
    }

    // Торговий міг їздити, але не мати зіставлених продажів — його теж показуємо.
    for (const f of fuel.data?.rows ?? []) {
      const existing = byId.get(f.repId);
      if (existing) {
        existing.km = f.workKm;
        existing.trips = f.trips;
        existing.days = f.daysWorked;
        existing.fuelCost = f.cost;
      } else if (f.trips > 0) {
        byId.set(f.repId, {
          id: f.repId,
          name: f.repName,
          amount: 0,
          docs: 0,
          km: f.workKm,
          trips: f.trips,
          days: f.daysWorked,
          fuelCost: f.cost,
          attainment: 0,
          target: 0,
        });
      }
    }

    for (const p of plans.data?.rows ?? []) {
      if (p.brandId) continue; // лише загальний план
      const existing = byId.get(p.repId);
      if (existing) {
        existing.attainment = p.attainment;
        existing.target = p.target;
      }
    }

    return Array.from(byId.values()).sort((a, b) => b.amount - a.amount);
  }, [sales.data, fuel.data, plans.data]);

  const error = sales.error ?? fuel.error ?? plans.error;
  if (error) {
    return <ErrorBox message={error} onRetry={() => { sales.reload(); fuel.reload(); plans.reload(); }} />;
  }

  if (sales.loading && !sales.data) return <TableSkeleton rows={6} cols={6} />;

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Немає даних по торгових за період"
          hint="Продажі надходять із 1С, поїздки — з Telegram-бота. Якщо порожньо в обох, перевірте період."
        />
      </Card>
    );
  }

  return (
    <Card padded={false}>
      <div className="p-4 sm:p-5">
        <CardHeader
          title="Торгові за період"
          hint={`Виконання плану — за місяць ${month}. Клік по рядку відкриває профіль.`}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
              <th className="px-4 py-2.5">Торговий</th>
              <th className="px-4 py-2.5 text-right">Оборот, грн</th>
              <th className="px-4 py-2.5 text-right">Док.</th>
              <th className="px-4 py-2.5 text-right">Робочі км</th>
              <th className="px-4 py-2.5 text-right">Паливо, грн</th>
              <th className="px-4 py-2.5 text-right">грн/км</th>
              <th className="w-40 px-4 py-2.5">План місяця</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-g100">
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => router.push(`/admin/sales-analytics/${r.id}?from=${period.from}&to=${period.to}`)}
                className="cursor-pointer transition-colors hover:bg-g50"
              >
                <td className="px-4 py-3">
                  <span className="font-medium text-bk">{r.name}</span>
                  {r.trips > 0 && (
                    <span className="ml-2 text-xs text-g400">
                      {r.trips} поїзд. / {r.days} дн.
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">{money(r.amount)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-g600">{num(r.docs)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-g600">{num(r.km)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-g600">{money(r.fuelCost)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-g600">
                  {/* Оборот на кілометр: скільки виручки приносить кожен проїханий км */}
                  {r.km > 0 ? money(r.amount / r.km) : "—"}
                </td>
                <td className="px-4 py-3">
                  {r.target > 0 ? (
                    <ProgressBar percent={r.attainment} height={6} />
                  ) : (
                    <span className="text-xs text-g400">не задано</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
