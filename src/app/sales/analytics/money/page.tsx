"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { RankBar, StatCard, money, num } from "@/components/ui/Stat";
import { CardSkeleton, StatCardSkeleton } from "@/components/ui/Skeleton";
import { CATEGORICAL } from "@/lib/analytics/colors";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { AnalyticsHeader } from "../components/AnalyticsHeader";
import { EarningsBreakdown } from "../components/EarningsBreakdown";
import { ReceivablesList } from "../components/ReceivablesList";
import {
  useMyPlan,
  useMySummary,
  usePeriodFromUrl,
  withPeriod,
} from "../components/useSalesAnalytics";

/**
 * Дрілл у гроші: скільки зібрано, скільки винні, скільки з цього
 * заробив.
 *
 * Три секції поспіль саме в такому порядку — це один ланцюжок: продав →
 * зібрав → недозібрав → отримав. Дебіторка стоїть між зібраним і
 * заробітком не випадково: вона і є різниця між ними.
 */

function MoneySkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      <div className="mt-3">
        <CardSkeleton rows={5} />
      </div>
    </>
  );
}

function MoneyDrill() {
  const { data: session } = useSession();
  const period = usePeriodFromUrl();
  const summary = useMySummary(period);
  const plan = useMyPlan(period);

  const row = summary.row;
  const repId = row?.repId ?? (session?.user as { id?: string } | undefined)?.id ?? null;

  // Розбивка зібраного по фірмах живе в тій самій відповіді, що й план:
  // другого запиту заради неї не робимо.
  const collectedBrands = (plan.data?.brands ?? [])
    .filter((b) => b.collected > 0)
    .sort((a, b) => b.collected - a.collected);
  const maxCollected = collectedBrands[0]?.collected ?? 0;

  return (
    <>
      <AnalyticsHeader
        title="Гроші"
        subtitle={row?.repName}
        month={summary.data?.month}
        period={period}
        backTo={withPeriod("/sales", period)}
        showFrames={false}
      />

      {summary.error && <ErrorBox message={summary.error} onRetry={summary.reload} />}
      {summary.loading && !summary.data && <MoneySkeleton />}

      {row && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Відвантажено"
              value={money(row.revenue)}
              unit="₴"
              hint="оборот за період"
              accent={CATEGORICAL[0]}
            />
            <StatCard
              label="Зібрано"
              value={money(row.collected)}
              unit="₴"
              hint={
                row.revenue > 0
                  ? `${num((row.collected / row.revenue) * 100)}% від відвантаженого оплачено`
                  : "оплат за період немає"
              }
              accent={CATEGORICAL[4]}
            />
          </div>

          <Card className="mt-3">
            <CardHeader
              title="Зібрано по фірмах"
              hint="Гроші, рознесені на вас за оплатами клієнтів за обраний період."
            />
            {collectedBrands.length > 0 ? (
              <div>
                {collectedBrands.map((b) => (
                  <RankBar
                    key={b.brandId}
                    label={b.brandName}
                    value={b.collected}
                    max={maxCollected}
                    suffix="₴"
                    color={b.color}
                  />
                ))}
              </div>
            ) : plan.loading ? (
              <CardSkeleton rows={3} title={false} />
            ) : (
              <EmptyState
                title="Оплат за період немає"
                hint="Гроші рознесено по фірмах лише тоді, коли клієнт заплатив. Спробуйте ширший період."
              />
            )}
          </Card>

          <div className="mt-3">
            <ReceivablesList repId={repId} />
          </div>

          {plan.error ? (
            <div className="mt-3">
              <ErrorBox message={plan.error} onRetry={plan.reload} />
            </div>
          ) : plan.loading && !plan.data ? (
            <div className="mt-3">
              <CardSkeleton rows={5} />
            </div>
          ) : plan.data ? (
            <EarningsBreakdown earnings={plan.data.earnings} reconciles={plan.data.reconciles} />
          ) : null}

          <p className="mt-4 px-1 text-[11px] leading-relaxed text-g500">
            Заробіток рахується зі зібраних коштів, а не з обороту: продаж клієнту, який не
            заплатив, доходу не приносить. Тому дебіторка — це не покарання, а ваші ще не отримані
            гроші.
          </p>

          {/* Стара схема нікуди не зникла — але живе окремо, щоб дві
              різні суми заробітку не стояли поруч без пояснення. */}
          <p className="mt-2 px-1 text-[11px] text-g400">
            <Link
              href="/dashboard/commissions"
              className="cursor-pointer underline decoration-g300 underline-offset-2 transition-colors hover:text-g600"
            >
              Комісії за старою схемою
            </Link>{" "}
            — нараховуються при підтвердженні замовлення, ще до оплати, тож із сумою вище не
            збігаються.
          </p>
        </>
      )}
    </>
  );
}

export default function SalesMoneyPage() {
  return (
    <Suspense fallback={<MoneySkeleton />}>
      <MoneyDrill />
    </Suspense>
  );
}
