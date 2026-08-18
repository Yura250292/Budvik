"use client";

/**
 * Оболонка розділу «AI аналіз фірми».
 *
 * Чотири секції, кожна генерується й кешується окремо: керівник дивиться те,
 * що йому зараз потрібно, і платить токенами лише за це. Спільний стан —
 * вкладка й період — дзеркалиться в URL (?tab=&from=&to=), щоб посилання на
 * «торгові за серпень» можна було переслати.
 *
 * Стратегія стоїть першою навмисно: це відповідь на питання «що взагалі
 * коїться», а решта вкладок — обґрунтування під нею.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodPicker, kyivToday, type Period } from "@/components/ui/PeriodPicker";
import { SectionPanel } from "./SectionPanel";
import { StrategyBlocks } from "./StrategyBlocks";
import { RepBlocks } from "./RepBlocks";
import { ProductBlocks } from "./ProductBlocks";
import { DriverBlocks } from "./DriverBlocks";
import { SavedPanel } from "./SavedPanel";

const TABS = [
  { key: "strategy", label: "Стратегія" },
  { key: "reps", label: "Торгові" },
  { key: "products", label: "Товари" },
  { key: "logistics", label: "Логістика" },
  { key: "saved", label: "Збережені" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Що саме аналізує кожна секція — підпис під вкладкою. */
const TAB_HINTS: Record<TabKey, string> = {
  strategy:
    "Зведення трьох розділів: пріоритети власника і що робити з кожною людиною. Генерується останньою — спершу Торгові, Товари й Логістика за цей самий період.",
  reps: "По кожному торговому: сильні й слабкі сторони, кому дзвонити і навіщо, з якою рентабельністю продає.",
  products:
    "Рентабельність по брендах, що просувати, що залежалось на складі. Продажі — за період; залишки й оборотність — станом на зараз.",
  logistics:
    "Маршрутні листи водіїв: вартість точки, кілометри проти плану, інкасація, аномалії одометра.",
  saved:
    "Відкладені звіти з цифрами того дня, коли їх зробили. Відкриваються скільки завгодно разів і токенів не витрачають.",
};

/** Період за замовчуванням — поточний місяць: у ньому живуть плани. */
function defaultPeriod(): Period {
  const today = kyivToday();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function AiAnalysisShell() {
  const router = useRouter();
  const params = useSearchParams();

  const urlTab = params.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === urlTab) ? (urlTab as TabKey) : "strategy";

  const [period, setPeriod] = useState<Period>(() => {
    const from = params.get("from");
    const to = params.get("to");
    return from && to ? { from, to } : defaultPeriod();
  });

  // Дзеркалимо стан в URL через replace, а не push: інакше кожне перемикання
  // вкладки лягало б в історію і «назад» вело б не з розділу, а по його
  // вкладках (той самий підхід, що в AnalyticsShell).
  useEffect(() => {
    const next = new URLSearchParams();
    next.set("tab", tab);
    next.set("from", period.from);
    next.set("to", period.to);
    if (next.toString() !== params.toString()) {
      router.replace(`/admin/ai-analysis?${next.toString()}`, { scroll: false });
    }
  }, [tab, period, params, router]);

  const setTab = useCallback(
    (key: TabKey) => {
      const next = new URLSearchParams();
      next.set("tab", key);
      next.set("from", period.from);
      next.set("to", period.to);
      router.replace(`/admin/ai-analysis?${next.toString()}`, { scroll: false });
    },
    [period, router]
  );

  const query = useMemo(
    () => `from=${period.from}&to=${period.to}`,
    [period.from, period.to]
  );

  return (
    // pb-28 — той самий запас, що на решті сторінок адмінки: без нього
    // останній блок упирається рівно в край скрол-контейнера і читається як
    // обрізаний.
    <div className="flex flex-col gap-4 p-4 pb-28 md:p-6 md:pb-28">
      <header className="flex flex-col gap-3">
        <div>
          <h1 className="text-xl font-semibold text-bk">AI аналіз фірми</h1>
          <p className="mt-0.5 text-sm text-g500">
            Кожен розділ рахується з ваших даних і генерується окремо. Цифри рахує програма —
            модель лише пояснює і розставляє за важливістю.
          </p>
        </div>

        {/* В архіві період не при ділі: у кожного звіту свій, записаний
            при збереженні. Показувати тут вибір означало б натякати, що
            він щось фільтрує. */}
        {tab !== "saved" && <PeriodPicker value={period} onChange={setPeriod} />}

        <nav className="flex flex-wrap gap-1.5" aria-label="Розділи аналізу">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`cursor-pointer rounded-[var(--radius-btn)] px-3.5 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark ${
                tab === t.key
                  ? "bg-bk text-white"
                  : "border border-g200 bg-white text-g600 hover:border-g300 hover:text-bk"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <p className="text-xs text-g500">{TAB_HINTS[tab]}</p>
      </header>

      {tab === "strategy" && (
        <SectionPanel
          key={`strategy-${query}`}
          section="strategy"
          title="Стратегія"
          query={query}
          period={period}
          render={(payload, facts) => <StrategyBlocks payload={payload} facts={facts} period={period} />}
        />
      )}

      {tab === "reps" && (
        <SectionPanel
          key={`reps-${query}`}
          section="reps"
          title="Торгові"
          query={query}
          period={period}
          render={(payload, facts) => <RepBlocks payload={payload} facts={facts} period={period} />}
        />
      )}

      {tab === "products" && (
        <SectionPanel
          key={`products-${query}`}
          section="products"
          title="Товари"
          query={query}
          period={period}
          render={(payload, facts) => <ProductBlocks payload={payload} facts={facts} period={period} />}
        />
      )}

      {tab === "logistics" && (
        <SectionPanel
          key={`logistics-${query}`}
          section="logistics"
          title="Логістика"
          query={query}
          period={period}
          render={(payload, facts) => <DriverBlocks payload={payload} facts={facts} period={period} />}
        />
      )}

      {tab === "saved" && <SavedPanel />}
    </div>
  );
}
