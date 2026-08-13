"use client";

/**
 * Розділ «Водії»: усе, що стосується ролі водія, в одному місці.
 *
 * Раніше зарплата, листи й трек жили підвкладками «Аналітики торгових» —
 * розділу про зовсім інших людей. Спільного, крім слова «маршрут», у них
 * нічого немає: у торгового це поїздки й паливо, у водія — доставка й
 * зарплата за листами.
 *
 * Планувальник і маршрути доставки лишилися окремими сторінками (вони
 * завеликі й мають власний стан), тож у смужці вкладок вони — посилання,
 * а не панелі. Для користувача різниці немає: клік веде туди, куди
 * підказує назва.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PeriodPicker, kyivToday, type Period } from "@/components/ui/PeriodPicker";
import { PayrollTab } from "./PayrollTab";
import { SheetsTab } from "./SheetsTab";
import { SettingsTab } from "./SettingsTab";
import { LiveTrackTab } from "./LiveTrackTab";

/** Вкладки-панелі цієї сторінки. `period: false` — вкладка не залежить від дат. */
const TABS = [
  { key: "payroll", label: "Зарплата", period: true },
  { key: "live", label: "На маршруті", period: false },
  { key: "sheets", label: "Маршрутні листи", period: true },
  { key: "settings", label: "Налаштування", period: false },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Сусідні сторінки того ж процесу: спланувати → видати лист → оплатити. */
const LINKS = [
  { href: "/admin/erp/route-planner", label: "Планувальник" },
  { href: "/admin/erp/delivery-routes", label: "Маршрути доставки" },
] as const;

function defaultPeriod(): Period {
  const today = kyivToday();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function DriversShell() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<TabKey>(() => {
    const t = searchParams.get("tab");
    return TABS.some((x) => x.key === t) ? (t as TabKey) : "payroll";
  });
  const [period, setPeriod] = useState<Period>(() => {
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    return from && to ? { from, to } : defaultPeriod();
  });

  // Стан у querystring, щоб посилання на «серпень по листах» можна було
  // переслати. replace, а не push: інакше кожна зміна фільтра лягала б
  // в історію і «Назад» гортало б власні кліки.
  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== "payroll") params.set("tab", tab);
    params.set("from", period.from);
    params.set("to", period.to);
    router.replace(`/admin/drivers?${params.toString()}`, { scroll: false });
  }, [tab, period, router]);

  const onPeriodChange = useCallback((p: Period) => setPeriod(p), []);

  const showPeriod = TABS.find((t) => t.key === tab)?.period ?? false;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-bk sm:text-2xl">Водії</h1>
        <p className="mt-0.5 text-sm text-g500">
          Зарплата за маршрутними листами, доставка й позиція на карті
        </p>
      </div>

      <nav
        className="-mx-4 flex gap-5 overflow-x-auto border-b border-g200 px-4 sm:mx-0 sm:px-0"
        aria-label="Розділи водіїв"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`-mb-px shrink-0 cursor-pointer border-b-2 px-0.5 pb-2 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark ${
              tab === t.key ? "border-bk text-bk" : "border-transparent text-g500 hover:text-bk"
            }`}
          >
            {t.label}
          </button>
        ))}

        {/* Посилання, а не вкладки: ведуть на власні сторінки. Стрілка
            попереджає про перехід, щоб клік не виглядав зламаною вкладкою. */}
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="-mb-px flex shrink-0 cursor-pointer items-center gap-1 border-b-2 border-transparent px-0.5 pb-2 text-[13px] font-medium text-g500 transition-colors hover:text-bk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark"
          >
            {l.label}
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        ))}
      </nav>

      {showPeriod && <PeriodPicker value={period} onChange={onPeriodChange} />}

      {tab === "payroll" && (
        <PayrollTab period={period} onOpenSettings={() => setTab("settings")} />
      )}
      {tab === "live" && <LiveTrackTab />}
      {tab === "sheets" && <SheetsTab period={period} />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}
