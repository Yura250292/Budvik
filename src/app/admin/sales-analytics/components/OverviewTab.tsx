"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, RankBar, money, num } from "@/components/ui/Stat";
import { CardSkeleton, StatCardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { useApi } from "./useApi";
import { ErrorBox } from "./ErrorBox";
import { AskPanel } from "./AskPanel";

const TimelineChart = dynamic(() => import("./Charts").then((m) => m.TimelineChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full" />,
});
const RankingChart = dynamic(() => import("./Charts").then((m) => m.RankingChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[320px] w-full" />,
});

type AnalyticsResponse = {
  period: { days: number; from: string; to: string };
  scope: "all" | "single" | "own";
  totals: { docs: number; amount: number; average: number };
  byRep: Array<{ id: string; name: string; docs: number; amount: number }>;
  byBrand: Array<{ brand: string; qty: number; amount: number; docs: number }>;
  timeline: Array<{ day: string; docs: number; amount: number }>;
  topProducts: Array<{ name: string; sku: string; qty: number; amount: number }>;
  topClients: Array<{ name: string; docs: number; amount: number }>;
};

export function OverviewTab({
  period,
  rep,
  onRepChange,
  isManager,
}: {
  period: Period;
  rep: string;
  onRepChange: (id: string) => void;
  isManager: boolean;
}) {
  const url = `/api/admin/sales-analytics?from=${period.from}&to=${period.to}${rep ? `&rep=${rep}` : ""}`;
  const { data, loading, error, reload } = useApi<AnalyticsResponse>(url);

  if (error) return <ErrorBox message={error} onRetry={reload} />;

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
        <CardSkeleton rows={6} />
        <div className="grid gap-4 lg:grid-cols-2">
          <CardSkeleton rows={5} />
          <CardSkeleton rows={5} />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const maxBrand = Math.max(1, ...data.byBrand.map((b) => b.amount));
  const maxClient = Math.max(1, ...data.topClients.map((c) => c.amount));
  const maxProduct = Math.max(1, ...data.topProducts.map((p) => p.amount));
  const perDay = data.period.days > 0 ? data.totals.amount / data.period.days : 0;

  return (
    <div className="space-y-4">
      {/* Фільтр торгового доступний лише керівництву — торговий і так бачить своє */}
      {isManager && data.byRep.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="rep-filter" className="text-xs font-medium text-g500">
            Торговий:
          </label>
          <select
            id="rep-filter"
            value={rep}
            onChange={(e) => onRepChange(e.target.value)}
            className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-xs text-bk transition-colors hover:border-g300 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
          >
            <option value="">Усі торгові</option>
            {data.byRep.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {rep && (
            <Link
              href={`/admin/sales-analytics/${rep}?from=${period.from}&to=${period.to}`}
              className="cursor-pointer rounded-[var(--radius-btn)] bg-bk px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-bk-soft"
            >
              Профіль торгового →
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Оборот" value={money(data.totals.amount)} unit="грн" hint={`${data.period.days} дн.`} />
        <StatCard label="Документів" value={num(data.totals.docs)} hint="проведених із 1С" />
        <StatCard label="Середній чек" value={money(data.totals.average)} unit="грн" />
        <StatCard label="У середньому за день" value={money(perDay)} unit="грн" />
      </div>

      <AskPanel days={data.period.days} />

      <Card>
        <CardHeader title="Динаміка обороту" hint="За київською добою" />
        {data.timeline.length > 0 ? (
          <TimelineChart data={data.timeline} />
        ) : (
          <EmptyState title="Немає продажів за період" hint="Спробуйте розширити період або зняти фільтр торгового." />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Продажі по фірмах (брендах)"
            hint="Рахується з позицій документів, тому сума не збігається з оборотом на розмір знижок"
          />
          {data.byBrand.length > 0 ? (
            <RankingChart
              data={data.byBrand.slice(0, 12).map((b) => ({ name: b.brand, value: b.amount }))}
              height={Math.max(200, Math.min(12, data.byBrand.length) * 28 + 40)}
            />
          ) : (
            <EmptyState title="Немає даних по брендах" />
          )}
        </Card>

        <Card>
          <CardHeader title="Торгові" hint="Клік — повний профіль" />
          {data.byRep.length > 0 ? (
            <div className="space-y-0.5">
              {data.byRep.map((r) => (
                <Link
                  key={r.id}
                  href={`/admin/sales-analytics/${r.id}?from=${period.from}&to=${period.to}`}
                  className="-mx-2 block cursor-pointer rounded-[var(--radius-badge)] px-2 transition-colors hover:bg-g50"
                >
                  <RankBar
                    label={r.name}
                    value={r.amount}
                    max={Math.max(1, ...data.byRep.map((x) => x.amount))}
                    suffix={`${r.docs} док.`}
                  />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Немає продажів по торгових"
              hint="Можливо, документи з 1С не зіставилися з торговими за прізвищем."
            />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Топ клієнтів" />
          {data.topClients.length > 0 ? (
            <div className="space-y-0.5">
              {data.topClients.map((c, i) => (
                <RankBar key={i} label={c.name} value={c.amount} max={maxClient} suffix={`${c.docs} док.`} />
              ))}
            </div>
          ) : (
            <EmptyState title="Немає даних" />
          )}
        </Card>

        <Card>
          <CardHeader title="Топ товарів" />
          {data.topProducts.length > 0 ? (
            <div className="space-y-0.5">
              {data.topProducts.map((p, i) => (
                <RankBar
                  key={i}
                  label={p.name}
                  value={p.amount}
                  max={maxProduct}
                  suffix={`${num(p.qty)} шт.`}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="Немає даних" />
          )}
        </Card>
      </div>

      {maxBrand > 0 && data.byBrand.some((b) => b.brand === "Без бренду") && (
        <p className="text-xs text-g500">
          «Без бренду» — товари, яким ще не призначено бренд. Це не окрема фірма, а прогалина в довіднику.
        </p>
      )}
    </div>
  );
}
