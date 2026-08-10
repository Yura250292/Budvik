"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Gauge } from "@/components/ui/Gauge";
import { money } from "@/components/ui/Stat";
import { STATUS, attainmentStatus } from "@/lib/analytics/colors";
import { daysLeftInMonth, monthLabel } from "./useSalesAnalytics";

/**
 * Головний екран кабінету: напівкруг виконання місячного плану.
 *
 * План — єдиний показник, який має ціль, тож саме він заслуговує на
 * велику дугу. Решта чисел без цілі — це просто числа, і кільце навколо
 * них нічого б не додало.
 *
 * Рядок «лишилось X ₴ · N днів» — єдиний елемент, що перетворює число
 * на дію: та сама сума за 21 день і за 2 дні означає різне.
 */
export function HeroPlan({
  plan,
  month,
  planHref,
}: {
  plan: { target: number; actual: number; attainment: number };
  month: string;
  /** null — провалюватися нікуди (плану немає) */
  planHref: string | null;
}) {
  const hasTarget = plan.target > 0;
  const left = Math.max(0, plan.target - plan.actual);
  const daysLeft = daysLeftInMonth(month);
  const status = attainmentStatus(plan.attainment, hasTarget);

  return (
    <Card className="flex flex-col items-center text-center">
      <Gauge
        percent={plan.attainment}
        hasTarget={hasTarget}
        label={`Виконання плану за ${monthLabel(month)}`}
        caption={hasTarget ? `${money(plan.actual)} з ${money(plan.target)} ₴` : undefined}
      />

      <p className="mt-1 text-sm font-medium text-bk">План на {monthLabel(month)}</p>

      {hasTarget ? (
        <>
          <p className="mt-1 text-xs text-g500">
            {left > 0 ? (
              <>
                Лишилось{" "}
                <span className="font-semibold tabular-nums" style={{ color: STATUS[status].fg }}>
                  {money(left)} ₴
                </span>
                {daysLeft > 0 && ` · ${daysLeft} дн. до кінця місяця`}
              </>
            ) : (
              <span className="font-semibold" style={{ color: STATUS.good.fg }}>
                План виконано — перевиконання {money(plan.actual - plan.target)} ₴
              </span>
            )}
          </p>

          {planHref && (
            <Link
              href={planHref}
              className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-btn)] bg-bk px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-bk-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark"
            >
              Розбити по фірмах
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
        </>
      ) : (
        // Плану немає — провалюватися нікуди, тож кнопку не показуємо
        // взагалі, а не робимо її неактивною.
        <p className="mt-1 max-w-xs text-xs text-g500">
          План на {monthLabel(month)} не встановлено — попросіть керівника задати ціль, і тут
          з&apos;явиться відсоток виконання.
        </p>
      )}
    </Card>
  );
}
