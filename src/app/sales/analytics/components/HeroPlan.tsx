"use client";

import Link from "next/link";
import { ChevronRight, Hourglass, Target } from "lucide-react";
import { Gauge } from "@/components/ui/Gauge";
import { money } from "@/components/ui/Stat";
import { Card } from "@/components/cabinet/ui";
import { STATUS, attainmentStatus } from "@/lib/analytics/colors";
import { daysLeftInMonth, monthLabel } from "./useSalesAnalytics";

/**
 * Головний екран кабінету: дуга виконання місячного плану.
 *
 * План — єдиний показник, який має ціль, тож саме він заслуговує на
 * велику дугу. Решта чисел без цілі — це просто числа, і кільце навколо
 * них нічого б не додало.
 *
 * Два підписи, без яких картка вводить в оману. «За весь місяць, не за
 * період» — бо зверху стоять чипси періоду, і 68 % легко прочитати як
 * «за обрані 10 днів». А рядок «лишилось X ₴ · ≈ Y ₴ на день» — єдине
 * місце, де число перетворюється на дію: та сама сума за 21 день і за 2
 * дні означає різне.
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
  const perDay = daysLeft > 0 ? left / daysLeft : null;

  return (
    <Card className="flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-base font-semibold text-bk">План на {monthLabel(month)}</p>
          <p className="text-xs text-cab-t3">за весь місяць, не за період</p>
        </div>
        {hasTarget && daysLeft > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-warn-bg px-2.5 py-1.5 text-xs font-semibold text-warn-fg">
            <Hourglass size={14} />
            {daysLeft} {daysLeft === 1 ? "день" : daysLeft < 5 ? "дні" : "днів"} лишилось
          </span>
        )}
      </div>

      <div className="flex justify-center">
        <Gauge
          percent={plan.attainment}
          hasTarget={hasTarget}
          label={`Виконання плану за ${monthLabel(month)}`}
          caption={hasTarget ? `${money(plan.actual)} з ${money(plan.target)} ₴` : undefined}
        />
      </div>

      {hasTarget ? (
        <>
          {left > 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl bg-warn-bg p-3">
              <Target size={22} className="shrink-0 text-warn" />
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-bk">
                  Лишилось{" "}
                  <span className="tabular-nums" style={{ color: STATUS[status].fg }}>
                    {money(left)} ₴
                  </span>
                </p>
                {perDay != null && (
                  <p className="text-xs text-cab-t2">
                    ≈ {money(perDay)} ₴ на день до кінця місяця
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-xl bg-ok-bg p-3">
              <Target size={22} className="shrink-0 text-ok" />
              <p className="text-[15px] font-semibold text-ok-fg">
                План виконано — перевиконання {money(plan.actual - plan.target)} ₴
              </p>
            </div>
          )}

          {!!planHref && (
            <Link
              href={planHref}
              className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-bk text-[15px] font-semibold text-white"
            >
              Розбити по фірмах
              <ChevronRight size={18} className="text-primary" />
            </Link>
          )}
        </>
      ) : (
        // Плану немає — провалюватися нікуди, тож кнопку не показуємо
        // взагалі, а не робимо її неактивною.
        <p className="text-xs leading-relaxed text-cab-t3">
          План на {monthLabel(month)} не встановлено — попросіть керівника задати ціль, і тут
          з&apos;явиться відсоток виконання.
        </p>
      )}
    </Card>
  );
}
