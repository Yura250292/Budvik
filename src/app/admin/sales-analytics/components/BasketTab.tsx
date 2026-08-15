"use client";

/**
 * Кошик: що купують разом.
 *
 * Кожен рядок читається як готова фраза для торгового: «бере A — у N%
 * випадків бере й B». Тому напрямок показуємо сильніший з двох, а не
 * обидва відсотки поспіль: продавцю потрібна одна дія, а не таблиця
 * ймовірностей.
 */

import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { Badge } from "@/components/ui/Badge";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";

type BasketResponse = {
  period: { from: string; to: string };
  totalDocs: number;
  minTogether: number;
  pairs: Array<{
    productA: { id: string; name: string; brandName: string | null; docs: number };
    productB: { id: string; name: string; brandName: string | null; docs: number };
    together: number;
    confidenceAtoB: number;
    confidenceBtoA: number;
    lift: number;
  }>;
};

export function BasketTab({ period }: { period: Period }) {
  const { data, loading, error, reload } = useApi<BasketResponse>(
    `/api/admin/sales-analytics/clients/basket?from=${period.from}&to=${period.to}`
  );

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <TableSkeleton rows={10} />;
  if (!data) return null;

  if (data.pairs.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Пар не знайдено"
          hint={`За ${data.period.from} — ${data.period.to} немає товарів, які трапляються разом щонайменше ${data.minTogether} разів. Візьміть ширший період.`}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Накладних у вибірці" value={num(data.totalDocs)} hint="лише реалізації за період" />
        <StatCard label="Знайдено пар" value={num(data.pairs.length)} hint={`мінімум ${data.minTogether} спільних накладних`} />
        <StatCard
          label="Найсильніша пара"
          value={`×${data.pairs[0].lift.toFixed(1)}`}
          hint="у стільки разів частіше за випадковість"
        />
      </div>

      <p className="text-xs text-g500">
        «Разом» — у скількох накладних обидва товари. «Супровід» — наскільки часто до
        першого товару беруть другий. Множник показує, у скільки разів пара трапляється
        частіше, ніж якби товари купували незалежно: ×1 — випадковість, ×3 і вище —
        стійкий звʼязок.
      </p>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Що беруть разом"
            hint="Сортування — за силою звʼязку з поправкою на масштаб: угорі те, що і часто, і невипадково"
          />
        </div>
        <TableScroll minWidth={860}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                <th className="px-4 py-2.5">Якщо клієнт бере</th>
                <th className="px-4 py-2.5">…то часто бере й</th>
                <th className="px-4 py-2.5 text-right">Супровід</th>
                <th className="px-4 py-2.5 text-right">Разом</th>
                <th className="px-4 py-2.5 text-right">Множник</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-g100">
              {data.pairs.map((p, i) => {
                // Показуємо сильніший напрямок: торговому потрібна одна дія.
                const forward = p.confidenceAtoB >= p.confidenceBtoA;
                const from = forward ? p.productA : p.productB;
                const to = forward ? p.productB : p.productA;
                const conf = forward ? p.confidenceAtoB : p.confidenceBtoA;

                return (
                  <tr key={`${p.productA.id}-${p.productB.id}-${i}`} className="transition-colors hover:bg-g50">
                    <td className="px-4 py-3">
                      <span className="text-bk">{from.name}</span>
                      <span className="block text-[11px] text-g400">
                        {from.brandName ?? "—"} · у {num(from.docs)} накладних
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-bk">{to.name}</span>
                      <span className="block text-[11px] text-g400">{to.brandName ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold tabular-nums text-bk">{num(conf, 0)}%</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{num(p.together)}</td>
                    <td className="px-4 py-3 text-right">
                      <Badge status={p.lift >= 3 ? "good" : "neutral"}>×{p.lift.toFixed(1)}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </div>
  );
}
