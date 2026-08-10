"use client";

import { Suspense } from "react";
import { Card } from "@/components/ui/Card";
import { Skeleton, CardSkeleton } from "@/components/ui/Skeleton";
import { Gauge } from "@/components/ui/Gauge";
import { money } from "@/components/ui/Stat";
import { ErrorBox } from "@/app/admin/sales-analytics/components/ErrorBox";
import { AnalyticsHeader } from "../components/AnalyticsHeader";
import { BrandPlanList } from "../components/BrandPlanList";
import { EarningsBreakdown } from "../components/EarningsBreakdown";
import { useMyPlan, usePeriodFromUrl, withPeriod, monthLabel } from "../components/useSalesAnalytics";

/**
 * Дрілл у план: кільце на кожну фірму й відповідь на питання
 * «скільки я заробив саме з цієї фірми».
 *
 * Розклад заробітку по брендах не існує ніде, крім цього ендпоінта:
 * рушій мотивації рахує гроші, а не звітність, і його RuleResult не
 * несе brandId. Тому екран живиться окремим /api/sales/analytics/plan.
 */

function PlanSkeleton() {
  return (
    <>
      <Skeleton className="h-[200px] w-full rounded-[var(--radius-card)]" />
      <div className="mt-3">
        <CardSkeleton rows={5} />
      </div>
    </>
  );
}

function PlanDrill() {
  const period = usePeriodFromUrl();
  const { data, loading, error, reload } = useMyPlan(period);

  return (
    <>
      <AnalyticsHeader
        title="План по фірмах"
        subtitle={data?.rep.name}
        month={data?.month}
        period={period}
        backTo={withPeriod("/sales", period)}
        showFrames={false}
      />

      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data && <PlanSkeleton />}

      {data && (
        <>
          {/* Загальний напівкруг як якір: щоб було видно, з чого
              складається підсумок, у який торговий щойно провалився. */}
          <Card className="flex flex-col items-center text-center">
            <Gauge
              percent={data.plan.attainment}
              hasTarget={data.plan.target > 0}
              label={`Загальне виконання плану за ${monthLabel(data.month)}`}
              caption={
                data.plan.target > 0
                  ? `${money(data.plan.actual)} з ${money(data.plan.target)} ₴`
                  : undefined
              }
            />
            <p className="mt-1 text-sm font-medium text-bk">Разом по всіх фірмах</p>
            <p className="mt-0.5 text-xs text-g500">
              Виконання рахується за весь {monthLabel(data.month)} — план місячний.
            </p>
          </Card>

          <div className="mt-3">
            <BrandPlanList brands={data.brands} />
          </div>

          <EarningsBreakdown earnings={data.earnings} reconciles={data.reconciles} />

          <p className="mt-4 px-1 text-[11px] leading-relaxed text-g500">
            Оборот по фірмах рахується з позицій документів, тож їхня сума не збігається із
            загальним оборотом рівно на суму знижок. Заробіток — за обраний період, план — за
            календарний місяць.
          </p>
        </>
      )}
    </>
  );
}

export default function SalesPlanPage() {
  return (
    <Suspense fallback={<PlanSkeleton />}>
      <PlanDrill />
    </Suspense>
  );
}
