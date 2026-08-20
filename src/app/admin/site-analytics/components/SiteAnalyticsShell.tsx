"use client";

/**
 * Оболонка розділу «Відвідуваність сайту».
 *
 * Тримає спільний період і активну вкладку, дзеркалить їх у ?tab=&from=&to=
 * — щоб посилання на «пошук за минулий тиждень» можна було переслати.
 *
 * Розділ бачать лише ADMIN і MANAGER, тож менеджерських винятків, як у
 * sales-analytics, тут немає — доступ ріже middleware.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PeriodPicker, kyivToday, shiftDay, type Period } from "@/components/ui/PeriodPicker";
import { OverviewTab } from "./OverviewTab";
import { ProductsTab } from "./ProductsTab";
import { SearchTab } from "./SearchTab";
import { EventsTab } from "./EventsTab";

const TABS = [
  { key: "overview", label: "Огляд" },
  { key: "products", label: "Товари" },
  { key: "search", label: "Пошук" },
  { key: "events", label: "Події" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * Типово — останні 30 днів, а не «цей місяць»: першого числа розділ
 * інакше відкривався б майже порожнім.
 */
function defaultPeriod(): Period {
  const today = kyivToday();
  return { from: shiftDay(today, -29), to: today };
}

export function SiteAnalyticsShell() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<TabKey>(() => {
    const param = searchParams.get("tab");
    return TABS.some((t) => t.key === param) ? (param as TabKey) : "overview";
  });

  const [period, setPeriod] = useState<Period>(() => {
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    return from && to ? { from, to } : defaultPeriod();
  });

  // replace, а не push: інакше кожна зміна фільтра лягала б в історію і
  // «Назад» гортало б власні кліки замість виходу з розділу.
  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== "overview") params.set("tab", tab);
    params.set("from", period.from);
    params.set("to", period.to);
    router.replace(`/admin/site-analytics?${params.toString()}`, { scroll: false });
  }, [tab, period, router]);

  const onPeriodChange = useCallback((p: Period) => setPeriod(p), []);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-g200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[var(--radius-btn)] bg-bk">
                <svg className="h-4.5 w-4.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-bold leading-tight text-bk sm:text-xl">
                  Відвідуваність сайту
                </h1>
                <p className="truncate text-xs text-g400">
                  Хто заходить, що дивиться, що шукає
                </p>
              </div>
            </div>
            <Link
              href="/admin"
              className="flex flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--radius-btn)] bg-primary px-3.5 py-2 text-[13px] font-semibold text-bk transition-colors hover:bg-primary-hover"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="hidden sm:inline">В адмінку</span>
            </Link>
          </div>

          <nav className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:px-0" aria-label="Розділи вебаналітики">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-current={tab === t.key ? "page" : undefined}
                className={`relative shrink-0 cursor-pointer rounded-[var(--radius-btn)] px-3.5 py-2 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark ${
                  tab === t.key ? "bg-bk text-white" : "text-g600 hover:bg-g100 hover:text-bk"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 pt-4 pb-10 sm:px-6">
        <div className="mb-4">
          <PeriodPicker value={period} onChange={onPeriodChange} />
        </div>

        {tab === "overview" && <OverviewTab period={period} />}
        {tab === "products" && <ProductsTab period={period} />}
        {tab === "search" && <SearchTab period={period} />}
        {tab === "events" && <EventsTab period={period} />}
      </div>
    </div>
  );
}
