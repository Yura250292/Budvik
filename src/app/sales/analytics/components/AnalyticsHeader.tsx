"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PeriodPicker, type Period } from "@/components/ui/PeriodPicker";
import { monthLabel } from "./useSalesAnalytics";

/**
 * Шапка кабінету: заголовок, вибір періоду і — головне — рядок про три
 * різні часові рамки в одному екрані.
 *
 * Без цього рядка числа виглядають суперечливо: оборот за 10 днів поруч
 * із планом за весь місяць і боргом «станом на зараз» читається як
 * помилка в розрахунку. Той самий компроміс проговорено в заголовку
 * /api/admin/sales-analytics/summary.
 */
export function AnalyticsHeader({
  title,
  subtitle,
  month,
  period,
  backTo,
  showFrames = true,
}: {
  title: string;
  subtitle?: string;
  month?: string;
  period: Period;
  /** Куди веде «назад». Немає — кнопки немає (це хаб). */
  backTo?: string;
  /** Пояснення часових рамок доречне не на кожному екрані. */
  showFrames?: boolean;
}) {
  const router = useRouter();

  // Період у query, а не в стані: перехід у дрілл і назад має повертати
  // той самий діапазон. replace, не push — інакше кожен клік по пресету
  // додавав би запис в історію і «Назад» гортало б власні кліки.
  const onPeriodChange = (p: Period) => {
    const params = new URLSearchParams({ from: p.from, to: p.to });
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  return (
    <header className="mb-4">
      <div className="flex items-start gap-3">
        {backTo && (
          <Link
            href={backTo}
            aria-label="Назад"
            className="mt-0.5 flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-btn)] border border-g200 bg-white text-g600 transition-colors hover:border-g300 hover:text-bk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold leading-tight text-bk">{title}</h1>
          <p className="truncate text-xs text-g400">
            {subtitle}
            {subtitle && month ? " · " : ""}
            {month ? monthLabel(month) : ""}
          </p>
        </div>
      </div>

      <div className="-mx-4 mt-3 overflow-x-auto px-4 pb-0.5 scrollbar-hide">
        <div className="w-max">
          <PeriodPicker value={period} onChange={onPeriodChange} />
        </div>
      </div>

      {showFrames && (
        <p className="mt-2.5 text-[11px] leading-relaxed text-g500">
          Оборот, паливо і зібране — за обраний період. План —
          {month ? ` за весь ${monthLabel(month)}` : " за календарний місяць"}. Дебіторка — борг
          станом на зараз, від періоду не залежить.
        </p>
      )}
    </header>
  );
}
