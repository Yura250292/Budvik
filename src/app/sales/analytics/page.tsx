"use client";

import { Suspense } from "react";
import { useSession } from "next-auth/react";
import { Card, EmptyState } from "@/components/ui/Card";
import { Skeleton, StatCardSkeleton } from "@/components/ui/Skeleton";
import { ErrorBox } from "@/app/admin/sales-analytics/components/ErrorBox";
import { AnalyticsHeader } from "./components/AnalyticsHeader";
import { HeroPlan } from "./components/HeroPlan";
import { MetricGrid } from "./components/MetricGrid";
import { useMySummary, usePeriodFromUrl, withPeriod } from "./components/useSalesAnalytics";

/**
 * Кабінет торгового: ті самі 11 показників, що у зведеній керівника,
 * але подані під телефон і без порівняння з колегами.
 *
 * Один запит на весь екран — рівно той самий, що живить зведену. Копія
 * розрахунку під /api/sales/* дала б друге місце, де числа можуть
 * розійтися; тут вони не можуть за побудовою.
 */

function HubSkeleton() {
  return (
    <>
      <Skeleton className="h-[220px] w-full rounded-[var(--radius-card)]" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    </>
  );
}

function Hub() {
  const { data: session } = useSession();
  const period = usePeriodFromUrl();
  const { data, row, loading, error, reload } = useMySummary(period);

  const name = (session?.user as { name?: string } | undefined)?.name ?? "Мої показники";

  return (
    <>
      <AnalyticsHeader
        title="Мої показники"
        subtitle={name}
        month={data?.month}
        period={period}
      />

      {error && <ErrorBox message={error} onRetry={reload} />}

      {loading && !data && <HubSkeleton />}

      {data && !row && (
        <Card>
          <EmptyState
            title="За цей період даних немає"
            hint="Зведена будується по користувачах із роллю «Торговий». Якщо ви бачите це повідомлення, зверніться до керівника — можливо, обліковий запис ще не позначено як торгового."
          />
        </Card>
      )}

      {data && row && (
        <>
          <HeroPlan
            plan={row.plan}
            month={data.month}
            planHref={row.plan.target > 0 ? withPeriod("/sales/analytics/plan", period) : null}
          />
          <MetricGrid row={row} moneyHref={withPeriod("/sales/analytics/money", period)} />

          <p className="mt-4 px-1 text-[11px] leading-relaxed text-g500">
            «Чистий результат» — прибуток по ваших продажах за період мінус пальне. «Заробіток»
            рахується зі зібраних коштів, а не з обороту: продаж без оплати не приносить нічого.
          </p>
        </>
      )}
    </>
  );
}

export default function SalesAnalyticsPage() {
  // Suspense обов'язковий: період читається з useSearchParams.
  return (
    <Suspense fallback={<HubSkeleton />}>
      <Hub />
    </Suspense>
  );
}
