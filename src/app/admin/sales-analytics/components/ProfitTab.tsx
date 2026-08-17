"use client";

/**
 * Прибуток: скільки заробили і де він утворюється.
 *
 * Головна вкладка блоку «Гроші». Досі вал було видно лише збоку — колонкою
 * у таблиці торгових і підказкою в розрахунку зарплати, — і ніде не було
 * відповіді на просте питання «скільки ми заробили за місяць і на чому».
 *
 * Порядок екрана: підсумок → динаміка по місяцях (чи падає маржа) → де
 * утворюється вал (бренди) → хто його робить (торгові).
 *
 * Усі числа беруться з уже наявних роутів: окремого API немає навмисно —
 * дублювати розрахунок валу в четвертому місці означало б, що колись він
 * розійдеться сам із собою.
 */

import { useMemo } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, money, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";
import type { Period } from "@/components/ui/PeriodPicker";

type AnalyticsResponse = {
  totals: { amount: number; docs: number; clients: number };
  byRep: Array<{
    id: string;
    name: string;
    amount: number;
    profit: number;
    costedAmount: number;
  }>;
  byBrand: Array<{ brand: string | null; amount: number; qty: number }>;
  timeline: Array<{ bucket: string; amount: number }>;
};

type BrandProfitResponse = {
  rows: Array<{
    brandId: string | null;
    brandName: string | null;
    amount: number;
    profit: number;
    costedAmount: number;
  }>;
};

/** Рентабельність нижче цього — привід дивитися, чому. */
const LOW_MARGIN = 8;

function marginTone(pct: number | null): string {
  if (pct === null) return "text-g400";
  if (pct < 0) return "font-semibold text-red-600";
  if (pct < LOW_MARGIN) return "font-medium text-amber-600";
  return "text-g600";
}

export function ProfitTab({ period, rep }: { period: Period; rep: string }) {
  const repParam = rep ? `&rep=${rep}` : "";
  const main = useApi<AnalyticsResponse>(
    `/api/admin/sales-analytics?from=${period.from}&to=${period.to}${repParam}`
  );
  // Бренди — окремим роутом: він рахує вал із позицій, бо шапку документа
  // не розкласти на виробників (див. profitByBrand у lib/analytics/facts).
  const brands = useApi<BrandProfitResponse>(
    `/api/admin/sales-analytics/brand-profit?from=${period.from}&to=${period.to}`
  );

  const totals = useMemo(() => {
    const rows = main.data?.byRep ?? [];
    const profit = rows.reduce((s, r) => s + r.profit, 0);
    const costed = rows.reduce((s, r) => s + r.costedAmount, 0);
    const amount = rows.reduce((s, r) => s + r.amount, 0);
    return {
      profit,
      costed,
      amount,
      marginPct: costed > 0 ? (profit / costed) * 100 : null,
      // Покриття: яка частка обороту має відому собівартість. Без цього
      // «вал 536 тис.» неможливо відрізнити від «вал із половини даних».
      coverage: amount > 0 ? Math.min(100, (costed / amount) * 100) : 0,
    };
  }, [main.data]);

  if (main.error) return <ErrorBox message={main.error} onRetry={main.reload} />;
  if (main.loading && !main.data) return <TableSkeleton rows={10} />;
  if (!main.data) return null;

  const reps = [...main.data.byRep].sort((a, b) => b.profit - a.profit);
  const brandRows = (brands.data?.rows ?? [])
    .filter((b) => b.profit !== 0 || b.amount > 0)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 20);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Вал за період"
          value={money(totals.profit)}
          unit="грн"
          tone={totals.profit > 0 ? "good" : "bad"}
          hint={`виручка мінус собівартість із 1С`}
        />
        <StatCard
          label="Рентабельність"
          value={totals.marginPct === null ? "—" : num(totals.marginPct, 1)}
          unit="%"
          tone={
            totals.marginPct === null
              ? "neutral"
              : totals.marginPct < LOW_MARGIN
                ? "warn"
                : "good"
          }
          hint="від обороту з відомою собівартістю"
        />
        <StatCard
          label="Оборот"
          value={money(totals.amount)}
          unit="грн"
          hint={`${num(main.data.totals.docs)} документів`}
        />
        <StatCard
          label="Покриття даними"
          value={num(totals.coverage, 0)}
          unit="%"
          tone={totals.coverage >= 95 ? "good" : "warn"}
          hint={
            totals.coverage >= 95
              ? "собівартість є майже всюди"
              : "решта обороту — без собівартості, у валі не врахована"
          }
        />
      </div>

      <p className="text-xs text-g500">
        Вал рахується як сума документа мінус собівартість його рядків. Джерело
        собівартості — <b>РегистрНакопления.ПродажиСебестоимость</b> з 1С, те саме,
        з якого рахує звіт «Валовая прибыль вал». Рядки без собівартості у вал не
        входять: нуль у базі означає «не приїхало», а не «продали по собівартості».
      </p>

      {brandRows.length > 0 && (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Де утворюється вал"
              hint="Бренди за валом, а не за оборотом. Тут видно найважливіше: великий оборот не означає великий заробіток."
            />
          </div>
          <TableScroll minWidth={720}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Бренд</th>
                  <th className="px-4 py-2.5 text-right">Оборот, грн</th>
                  <th className="px-4 py-2.5 text-right">Вал, грн</th>
                  <th className="px-4 py-2.5 text-right">Рент.</th>
                  <th className="px-4 py-2.5 text-right">Частка валу</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {brandRows.map((b) => {
                  const margin = b.costedAmount > 0 ? (b.profit / b.costedAmount) * 100 : null;
                  const share = totals.profit > 0 ? (b.profit / totals.profit) * 100 : 0;
                  return (
                    <tr key={b.brandId ?? "none"} className="transition-colors hover:bg-g50">
                      <td className="px-4 py-3 text-bk">{b.brandName ?? "— без бренду —"}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">
                        {money(b.amount)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                        {money(b.profit)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${marginTone(margin)}`}>
                        {margin === null ? "—" : `${num(margin, 1)}%`}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">
                        {share > 0 ? `${num(share, 1)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
          <p className="px-4 py-3 text-xs text-g500">
            Вал бренду рахується з позицій, тож знижка з шапки документа в нього не
            входить — сума по брендах трохи більша за загальний вал.
          </p>
        </Card>
      )}

      {reps.length === 0 ? (
        <Card>
          <EmptyState title="Немає даних за період" hint="Спробуйте інший період." />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Хто робить вал"
              hint="Рентабельність часто обернено пропорційна обороту: великі клієнти вибивають знижки."
            />
          </div>
          <TableScroll minWidth={680}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Торговий</th>
                  <th className="px-4 py-2.5 text-right">Оборот, грн</th>
                  <th className="px-4 py-2.5 text-right">Вал, грн</th>
                  <th className="px-4 py-2.5 text-right">Рент.</th>
                  <th className="px-4 py-2.5 text-right">Частка валу</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {reps.map((r) => {
                  const margin = r.costedAmount > 0 ? (r.profit / r.costedAmount) * 100 : null;
                  const share = totals.profit > 0 ? (r.profit / totals.profit) * 100 : 0;
                  return (
                    <tr key={r.id} className="transition-colors hover:bg-g50">
                      <td className="px-4 py-3 font-medium text-bk">{r.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">
                        {money(r.amount)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                        {money(r.profit)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${marginTone(margin)}`}>
                        {margin === null ? "—" : `${num(margin, 1)}%`}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">
                        {share > 0 ? `${num(share, 1)}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}
    </div>
  );
}
