"use client";

/**
 * «Логістика → Водії: зарплата і каса».
 *
 * Колись це була окрема «Аналітика водіїв» разом із картою «На маршруті».
 * Карта переїхала в «Рух на карті» (там тепер і торгові, і водії), маршрути
 * й журнал листів — у «Доставку». Тут лишилося те, що рахується з уже
 * проїханого: зарплата за листами, здача каси й прив'язка водіїв до 1С.
 *
 * Вкладки — пігулками, а не підкресленням: підкреслена смужка вище належить
 * розділу, і дві однакові смужки одна під одною читалися б як один рівень.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodPicker, kyivToday, type Period } from "@/components/ui/PeriodPicker";
import { PayrollTab } from "./PayrollTab";
import { SettingsTab } from "./SettingsTab";
import { CashTab } from "./CashTab";

/** Вкладки-панелі цієї сторінки. `period: false` — вкладка не залежить від дат. */
const TABS = [
  { key: "payroll", label: "Зарплата", period: true },
  { key: "cash", label: "Інкасація", period: true },
  { key: "settings", label: "Налаштування", period: false },
] as const;

type TabKey = (typeof TABS)[number]["key"];

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

  /**
   * Водій із посилання «AI-аналізу»: там пропонують подивитися конкретну
   * людину, і без цього рядка клік приводив на загальну таблицю, де її ще
   * треба знайти очима. Читаємо один раз при монтуванні — далі рядок
   * розгортає сам користувач.
   */
  const [initialDriver] = useState(() => searchParams.get("driver"));

  // Стан у querystring, щоб посилання на «серпень по зарплаті» можна було
  // переслати. replace, а не push: інакше кожна зміна фільтра лягала б
  // в історію і «Назад» гортало б власні кліки.
  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== "payroll") params.set("tab", tab);
    params.set("from", period.from);
    params.set("to", period.to);
    router.replace(`/admin/logistics/drivers?${params.toString()}`, { scroll: false });
  }, [tab, period, router]);

  const onPeriodChange = useCallback((p: Period) => setPeriod(p), []);

  const showPeriod = TABS.find((t) => t.key === tab)?.period ?? false;

  return (
    <div className="space-y-4">
      <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Гроші водіїв">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`min-h-[38px] shrink-0 cursor-pointer rounded-[var(--radius-btn)] px-3.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark ${
              tab === t.key ? "bg-bk text-white" : "text-g600 hover:bg-g100 hover:text-bk"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {showPeriod && <PeriodPicker value={period} onChange={onPeriodChange} />}

      {tab === "payroll" && (
        <PayrollTab
          period={period}
          initialDriver={initialDriver}
          onOpenSettings={() => setTab("settings")}
        />
      )}
      {tab === "cash" && <CashTab period={period} />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}
