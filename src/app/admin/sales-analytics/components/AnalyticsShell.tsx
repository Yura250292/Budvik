"use client";

/**
 * Оболонка центру «Аналітика торгових».
 *
 * Тримає спільний для всіх вкладок стан — період і фільтр торгового — і
 * дзеркалить його в URL. Раніше фільтри жили лише в пам'яті компонента, тож
 * посилання на «жовтень по Кулику» переслати було неможливо.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { PeriodPicker, kyivToday, type Period } from "@/components/ui/PeriodPicker";
import { OverviewTab } from "./OverviewTab";
import { RepsTab } from "./RepsTab";
import { PlansTab } from "./PlansTab";
import { RoutesTab } from "./RoutesTab";
import { FuelTab } from "./FuelTab";
import { TripsTab } from "./TripsTab";

const TABS = [
  { key: "overview", label: "Огляд" },
  { key: "reps", label: "Торгові" },
  { key: "plans", label: "КПІ та плани" },
  { key: "routes", label: "Маршрути" },
  { key: "fuel", label: "Паливо" },
  { key: "trips", label: "Поїздки" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Вкладки, доступні лише керівництву: там видно всю команду. */
const MANAGER_ONLY: TabKey[] = ["plans", "routes", "fuel", "trips"];

function defaultPeriod(): Period {
  const today = kyivToday();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function AnalyticsShell() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const role = (session?.user as { role?: string } | undefined)?.role ?? "";
  const isManager = role === "ADMIN" || role === "MANAGER";

  const urlTab = searchParams.get("tab") as TabKey | null;
  const [tab, setTab] = useState<TabKey>(urlTab && TABS.some((t) => t.key === urlTab) ? urlTab : "overview");
  const [period, setPeriod] = useState<Period>(() => {
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    return from && to ? { from, to } : defaultPeriod();
  });
  const [rep, setRep] = useState<string>(searchParams.get("rep") ?? "");

  const visibleTabs = useMemo(
    () => TABS.filter((t) => isManager || !MANAGER_ONLY.includes(t.key)),
    [isManager]
  );

  // Торговий, що потрапив на менеджерську вкладку через URL, повертається на огляд.
  useEffect(() => {
    if (!isManager && MANAGER_ONLY.includes(tab)) setTab("overview");
  }, [isManager, tab]);

  // Стан у querystring: replace, а не push — інакше кожна зміна фільтра
  // додавала б запис в історію і «Назад» гортало б власні кліки.
  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== "overview") params.set("tab", tab);
    params.set("from", period.from);
    params.set("to", period.to);
    if (rep) params.set("rep", rep);
    router.replace(`/admin/sales-analytics?${params.toString()}`, { scroll: false });
  }, [tab, period, rep, router]);

  const onPeriodChange = useCallback((p: Period) => setPeriod(p), []);

  if (status === "loading") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-g300 border-t-bk motion-reduce:animate-none" />
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm text-g600">Потрібен вхід.</p>
        <Link
          href="/login"
          className="mt-3 inline-block cursor-pointer rounded-[var(--radius-btn)] bg-primary px-4 py-2 text-sm font-semibold text-bk transition-colors hover:bg-primary-hover"
        >
          Увійти
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-g200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[var(--radius-btn)] bg-bk">
                <svg className="h-4.5 w-4.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-bold leading-tight text-bk sm:text-xl">
                  Аналітика торгових
                </h1>
                <p className="truncate text-xs text-g400">
                  {isManager ? "Продажі з 1С, поїздки, КПІ та логістика" : "Ваші продажі та поїздки"}
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

          <nav className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:px-0" aria-label="Розділи аналітики">
            {visibleTabs.map((t) => (
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
        {/* Період не потрібен вкладкам КПІ (там свій вибір місяця) і Маршрути (там день) */}
        {tab !== "plans" && tab !== "routes" && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <PeriodPicker value={period} onChange={onPeriodChange} />
          </div>
        )}

        {tab === "overview" && <OverviewTab period={period} rep={rep} onRepChange={setRep} isManager={isManager} />}
        {tab === "reps" && <RepsTab period={period} />}
        {tab === "plans" && <PlansTab />}
        {tab === "routes" && <RoutesTab />}
        {tab === "fuel" && <FuelTab period={period} />}
        {tab === "trips" && <TripsTab period={period} rep={rep} onRepChange={setRep} />}
      </div>
    </div>
  );
}
