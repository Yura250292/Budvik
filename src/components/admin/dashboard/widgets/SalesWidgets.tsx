"use client";

import { money, num } from "@/components/ui/Stat";
import { categoricalColor, STATUS, attainmentStatus } from "@/lib/analytics/colors";
import { useDashboardData } from "../DashboardData";
import { Bar, Metric, WidgetBody } from "./parts";

const ANALYTICS = "/admin/sales-analytics";

/** Головні гроші періоду: оборот, документи, середній чек, прибуток. */
export function SalesTotals() {
  const { summary, period } = useDashboardData();
  const t = summary.data?.totals;
  return (
    <WidgetBody
      title="Продажі за період"
      hint="Реалізації з 1С"
      href={`${ANALYTICS}?from=${period.from}&to=${period.to}`}
      loading={summary.loading}
      error={summary.error}
      empty={!!summary.data && t?.docs === 0}
    >
      {t && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Metric label="Оборот" value={`${money(t.revenue)} ₴`} />
          <Metric label="Документів" value={num(t.docs)} />
          <Metric label="Середній чек" value={`${money(t.avgCheck)} ₴`} />
          {/* Прибуток приходить нулем, поки в документах немає собівартості.
              Показувати «0 ₴» як факт — оманливо: це не нульова маржа, а
              відсутні дані. */}
          <Metric
            label="Прибуток"
            value={t.profit > 0 ? `${money(t.profit)} ₴` : "—"}
            sub={t.profit > 0 ? undefined : "немає собівартості"}
          />
        </div>
      )}
    </WidgetBody>
  );
}

/** Виконання місячного плану — окремо, бо рахується за календарний місяць. */
export function PlanAttainment() {
  const { summary } = useDashboardData();
  const t = summary.data?.totals;
  const month = summary.data?.month;
  const pct = t?.plan.attainment ?? 0;
  const hasTarget = (t?.plan.target ?? 0) > 0;
  const color = STATUS[attainmentStatus(pct, hasTarget)].mark;

  return (
    <WidgetBody
      title="Виконання плану"
      hint={month ? `Місяць ${month} — план місячний, не за період` : undefined}
      href={`${ANALYTICS}?tab=kpi`}
      loading={summary.loading}
      error={summary.error}
    >
      {t && (
        <div className="flex h-full flex-col justify-center">
          {!hasTarget ? (
            // Без плану показуємо хоча б факт місяця — інакше картка
            // порожня і місце на дашборді витрачене намарно.
            <>
              <p className="text-[13px] text-g500">План на місяць не задано</p>
              <p className="mt-2 text-[24px] font-bold leading-none tabular-nums text-bk">
                {money(t.plan.actual)} ₴
              </p>
              <p className="mt-1 text-[11px] text-g500">оборот за місяць</p>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-[32px] font-bold leading-none tabular-nums" style={{ color }}>
                  {num(pct)}%
                </span>
                <span className="text-[12px] text-g500">
                  {money(t.plan.actual)} з {money(t.plan.target)} ₴
                </span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-g200">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color }}
                />
              </div>
            </>
          )}
        </div>
      )}
    </WidgetBody>
  );
}

/** Зібрані гроші й дебіторка — те, за чим стежать щодня. */
export function MoneyWidget() {
  const { summary, period } = useDashboardData();
  const t = summary.data?.totals;
  const overdueRatio = t && t.receivableTotal > 0 ? (t.receivableOverdue / t.receivableTotal) * 100 : 0;

  return (
    <WidgetBody
      title="Гроші"
      hint="Зібрано — за період, дебіторка — на зараз"
      href={`${ANALYTICS}?tab=summary&from=${period.from}&to=${period.to}`}
      loading={summary.loading}
      error={summary.error}
    >
      {t && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Metric label="Зібрано" value={`${money(t.collected)} ₴`} tone="good" />
          <Metric label="Дебіторка" value={`${money(t.receivableTotal)} ₴`} />
          <Metric
            label="Прострочено"
            value={`${money(t.receivableOverdue)} ₴`}
            sub={t.receivableTotal > 0 ? `${num(overdueRatio)}% боргу` : undefined}
            tone={overdueRatio > 0 ? "bad" : undefined}
          />
        </div>
      )}
    </WidgetBody>
  );
}

/** Рейтинг торгових за оборотом — клік веде у профіль. */
export function TopReps() {
  const { summary, period } = useDashboardData();
  const rows = (summary.data?.rows ?? []).filter((r) => r.revenue > 0).slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r.revenue));

  return (
    <WidgetBody
      title="Торгові за оборотом"
      hint="Клік — профіль торгового"
      href={ANALYTICS}
      loading={summary.loading}
      error={summary.error}
      empty={!!summary.data && rows.length === 0}
      emptyText="Продажів за період ще немає"
    >
      <div className="h-full overflow-y-auto">
        {rows.map((r, i) => (
          <Bar
            key={r.repId}
            label={r.repName}
            value={r.revenue}
            max={max}
            display={money(r.revenue)}
            suffix={`${num(r.docs)} док.`}
            color={categoricalColor(i)}
            href={`${ANALYTICS}/${r.repId}?from=${period.from}&to=${period.to}`}
          />
        ))}
      </div>
    </WidgetBody>
  );
}

/**
 * Торгові, у яких найбільше простроченої дебіторки.
 * Це «кому дзвонити сьогодні», тому окремо від рейтингу за оборотом.
 */
export function OverdueReps() {
  const { summary, period } = useDashboardData();
  const rows = (summary.data?.rows ?? [])
    .filter((r) => r.receivables.overdue > 0)
    .sort((a, b) => b.receivables.overdue - a.receivables.overdue)
    .slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r.receivables.overdue));

  return (
    <WidgetBody
      title="Прострочена дебіторка"
      hint="За торговими, станом на зараз"
      href={ANALYTICS}
      loading={summary.loading}
      error={summary.error}
      empty={!!summary.data && rows.length === 0}
      emptyText="Простроченої дебіторки немає"
    >
      <div className="h-full overflow-y-auto">
        {rows.map((r) => (
          <Bar
            key={r.repId}
            label={r.repName}
            value={r.receivables.overdue}
            max={max}
            display={money(r.receivables.overdue)}
            suffix={`${num(r.receivables.overdueRatio)}%`}
            color={STATUS.bad.mark}
            href={`${ANALYTICS}/${r.repId}?from=${period.from}&to=${period.to}`}
          />
        ))}
      </div>
    </WidgetBody>
  );
}
