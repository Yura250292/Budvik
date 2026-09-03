"use client";

/**
 * Оболонка центру «Аналітика продажів».
 *
 * Розділ виріс зі «звіту по торгових»: спершу тут були лише продажі й КПІ, а
 * потім додались собівартість, знижки, ABC, клієнтські звіти. Половина вкладок
 * перестала бути про людей, тому і назва, і групування — за питаннями:
 * скільки заробили → що продаємо → кому → хто продає → як доїхало.
 *
 * Тримає спільний для всіх вкладок стан — період, фільтр торгового, вкладку
 * з підвкладкою — і дзеркалить його в URL (?tab=&view=). Раніше фільтри жили
 * лише в пам'яті компонента, тож посилання на «жовтень по Кулику» переслати
 * було неможливо.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useGateSession } from "@/lib/useGateSession";
import { PeriodPicker, kyivToday, type Period } from "@/components/ui/PeriodPicker";
import { SummaryTab } from "./SummaryTab";
import { OverviewTab } from "./OverviewTab";
import { RepsTab } from "./RepsTab";
import { ReturnsTab } from "./ReturnsTab";
import { FieldWorkTab } from "./FieldWorkTab";
import { AbcTab } from "./AbcTab";
import { DiscountsTab } from "./DiscountsTab";
import { ProfitTab } from "./ProfitTab";
import { BenchmarkTab } from "./BenchmarkTab";
import { PlansTab } from "./PlansTab";
import { RoutesTab } from "./RoutesTab";
import { ClientMapTab } from "./ClientMapTab";
import { FuelTab } from "./FuelTab";
import { TripsTab } from "./TripsTab";
import { MotivationTab } from "./MotivationTab";
import { PayrollTab } from "./PayrollTab";
import { ShiftsTab } from "./ShiftsTab";
import { PayersTab } from "./PayersTab";
import { CohortsTab } from "./CohortsTab";
import { BasketTab } from "./BasketTab";
import { GeoTab } from "./GeoTab";

/**
 * Верхні вкладки — за питанням, на яке відповідають, а не за джерелом даних.
 *
 * Розділ виріс із «звіту по торгових» у наскрізну аналітику продажів, і
 * половина вкладок уже не про людей: знижки, ABC, оборотність — це про
 * товар і гроші. Тому порядок такий: спершу СКІЛЬКИ ЗАРОБИЛИ (гроші), потім
 * ЩО продаємо (асортимент), КОМУ (клієнти), ХТО продає (торгові) і ЯК
 * доїхало (логістика).
 *
 * Ключі свідомо лишені старі (`overview`, `reps`, `kpi`): вони живуть у
 * закладках, у віджетах дашборда (`?tab=overview`, `?tab=kpi`) і в редіректі
 * /admin/sales-reports. Перейменування ключів зламало б усе це заради
 * охайності в коді.
 */
const TABS = [
  { key: "summary", label: "Зведена" },
  { key: "money", label: "Гроші" },
  { key: "overview", label: "Асортимент" },
  { key: "clients", label: "Клієнти" },
  { key: "reps", label: "Торгові" },
  { key: "kpi", label: "КПІ та мотивація" },
  { key: "logistics", label: "Логістика" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * Підвкладки об'єднаних розділів; перша в списку — типова. «Логістика» зібрала
 * поїздки, маршрути й паливо: це один процес (виїхав → де був → скільки коштувало),
 * тримати його трьома верхніми вкладками означало губити зв'язок між ними.
 */
const SUBTABS = {
  // ГРОШІ: скільки заробили і скільки віддали. Вал і знижки поруч навмисно —
  // це дві половини одного питання, і читати їх окремо означає не побачити,
  // що 29% валу пішло на знижки.
  money: [
    { key: "profit", label: "Прибуток" },
    { key: "discounts", label: "Знижки" },
  ],
  // АСОРТИМЕНТ: що саме продаємо і що лежить. Ключ вкладки — старий
  // `overview`, бо на нього посилаються віджети дашборда.
  overview: [
    { key: "sales", label: "Продажі" },
    { key: "abc", label: "ABC / XYZ" },
  ],
  // КЛІЄНТИ: хто платить, хто приживається, що беруть разом, де ми сильні.
  clients: [
    { key: "payers", label: "Платники" },
    { key: "cohorts", label: "Утримання" },
    { key: "basket", label: "Кошик" },
    { key: "geo", label: "Географія" },
    // Карта переїхала сюди з логістики: вона про клієнтів, а не про те, як
    // машина їхала. Старий ключ ?view=clients у логістиці лишився в
    // LEGACY_VIEWS нижче.
    { key: "map", label: "Карта" },
  ],
  reps: [
    { key: "list", label: "Показники" },
    { key: "benchmark", label: "Порівняння" },
    { key: "returns", label: "Повернення" },
    // Польова робота стоїть саме тут, а не в «Клієнтах»: міряє вона не
    // стан бази, а те, що робить людина — уточнює точки, знімає магазини,
    // лишає нотатки. Це такий самий показник торгового, як оборот.
    { key: "field", label: "Польова робота" },
  ],
  kpi: [
    { key: "plans", label: "Плани" },
    { key: "motivation", label: "Мотивація" },
    { key: "payroll", label: "Розрахунок" },
  ],
  logistics: [
    { key: "trips", label: "Поїздки" },
    { key: "shifts", label: "Зміни" },
    { key: "routes", label: "Маршрути" },
    { key: "fuel", label: "Паливо" },
  ],
} as const;

type ViewKey = (typeof SUBTABS)[keyof typeof SUBTABS][number]["key"];

/**
 * Старі ключі вкладок → нове місце. Живуть у закладках користувачів,
 * редіректі /admin/sales-reports (?tab=trips) і посиланнях дашборда.
 */
const LEGACY_TABS: Record<string, { tab: TabKey; view: ViewKey }> = {
  plans: { tab: "kpi", view: "plans" },
  motivation: { tab: "kpi", view: "motivation" },
  trips: { tab: "logistics", view: "trips" },
  routes: { tab: "logistics", view: "routes" },
  fuel: { tab: "logistics", view: "fuel" },
};

/**
 * Підвкладки, що переїхали між вкладками при перегрупуванні.
 *
 * Ключ — старе `tab:view`, значення — нове місце. Без цього закладка на
 * знижки (вони жили в «Огляді») відкривала б «Продажі», і людина думала б,
 * що звіт зник. Карта клієнтів так само переїхала з логістики.
 */
const LEGACY_VIEWS: Record<string, { tab: TabKey; view: ViewKey }> = {
  "overview:discounts": { tab: "money", view: "discounts" },
  "logistics:clients": { tab: "clients", view: "map" },
};

/**
 * Водії переїхали у власний розділ /admin/drivers — тут лишилися торгові.
 * Старі підвкладки мапимо на нові ключі, бо колишній «driver-settings»
 * там зветься просто «settings».
 */
const DRIVER_VIEW_MOVED: Record<string, string> = {
  payroll: "payroll",
  live: "live",
  sheets: "sheets",
  "driver-settings": "settings",
};

/**
 * Вкладки, доступні лише керівництву: там видно всю команду.
 *
 * «Клієнти» теж сюди: кредитні ліміти й відтік — рішення керівника по всій
 * базі, і роути цих звітів торговому й так віддають 403.
 */
const MANAGER_ONLY: TabKey[] = ["money", "clients", "kpi", "logistics"];

/**
 * Підвкладки лише для керівництва. «Порівняння» — рейтинг колег: API його
 * торговому й так не віддасть (403), але показувати вкладку, яка завжди
 * помиляється, гірше, ніж не показувати зовсім.
 */
const MANAGER_ONLY_VIEWS: ViewKey[] = ["benchmark", "field"];

function subtabsOf(tab: TabKey): ReadonlyArray<{ key: ViewKey; label: string }> | null {
  return tab in SUBTABS ? SUBTABS[tab as keyof typeof SUBTABS] : null;
}

/** Розбирає ?tab=&view= з урахуванням старих ключів і невалідних значень. */
function resolveTarget(
  tabParam: string | null,
  viewParam: string | null
): { tab: TabKey; view: ViewKey | null } {
  const legacy = tabParam ? LEGACY_TABS[tabParam] : undefined;
  if (legacy) return legacy;

  // Переїзд підвкладки перевіряється до валідації: у нової вкладки такого
  // ключа вже немає, тож інакше він мовчки замінився б на першу підвкладку.
  const moved = LEGACY_VIEWS[`${tabParam}:${viewParam}`];
  if (moved) return moved;
  const tab = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "summary";
  const views = subtabsOf(tab);
  if (!views) return { tab, view: null };
  const view = views.some((v) => v.key === viewParam) ? (viewParam as ViewKey) : views[0].key;
  return { tab, view };
}

function defaultPeriod(): Period {
  const today = kyivToday();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export function AnalyticsShell() {
  const { session, status } = useGateSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const role = (session?.user as { role?: string } | undefined)?.role ?? "";
  const isManager = role === "ADMIN" || role === "MANAGER";

  const [target, setTarget] = useState(() =>
    resolveTarget(searchParams.get("tab"), searchParams.get("view"))
  );
  // Торговий, що потрапив на менеджерську вкладку через URL, бачить зведену.
  // Похідне значення, а не setState в ефекті: стан лишається, але не рендериться.
  // Те саме для підвкладок: «Порівняння» підміняється на першу доступну,
  // інакше торговий за посиланням отримав би 403 замість даних.
  const { tab, view } = !isManager
    ? MANAGER_ONLY.includes(target.tab)
      ? { tab: "summary" as TabKey, view: null }
      : target.view && MANAGER_ONLY_VIEWS.includes(target.view)
        ? { tab: target.tab, view: subtabsOf(target.tab)?.[0].key ?? null }
        : target
    : target;
  // Фокус мапи дня: виставляється кліком «поза маршрутом» у поїздках,
  // щоб «Маршрути» відкрилися одразу на потрібному торговому й дні.
  const [dayFocus, setDayFocus] = useState<{ repId: string; date: string } | null>(null);
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

  const openDayMap = useCallback((repId: string, date: string) => {
    setDayFocus({ repId, date });
    setTarget({ tab: "logistics", view: "routes" });
  }, []);

  // Торговий за старим посиланням потрапляє у власний кабінет: зведена на
  // 1180px не читається з телефона, а показники там ті самі. Період
  // переносимо, інакше він мовчки скинувся б на типовий.
  // replace, а не push — щоб «Назад» не кидало в цикл редіректів.
  const leavingToCabinet = status === "authenticated" && role === "SALES";

  // Закладка на ?tab=drivers — розділ переїхав. Читаємо параметр з URL, а
  // не з target: resolveTarget уже підмінив невідому вкладку на зведену.
  // Торгового туди не шлемо: middleware його там і так відіб'є на /admin,
  // а кабінет — правильніша адреса, ніж зайвий стрибок.
  const leavingToDrivers = searchParams.get("tab") === "drivers" && !leavingToCabinet;

  const leaving = leavingToCabinet || leavingToDrivers;

  useEffect(() => {
    if (leavingToCabinet) {
      router.replace(`/sales/analytics?from=${period.from}&to=${period.to}`);
      return;
    }
    if (leavingToDrivers) {
      const v = DRIVER_VIEW_MOVED[searchParams.get("view") ?? ""] ?? "payroll";
      router.replace(`/admin/drivers?tab=${v}&from=${period.from}&to=${period.to}`);
    }
  }, [leavingToCabinet, leavingToDrivers, searchParams, period.from, period.to, router]);

  // Стан у querystring: replace, а не push — інакше кожна зміна фільтра
  // додавала б запис в історію і «Назад» гортало б власні кліки.
  useEffect(() => {
    // Поки триває редірект, ефект не спрацьовує: він переписав би URL назад
    // на /admin/sales-analytics і переміг би перехід.
    if (leaving) return;

    const params = new URLSearchParams();
    if (tab !== "summary") params.set("tab", tab);
    const views = subtabsOf(tab);
    if (views && view && view !== views[0].key) params.set("view", view);
    params.set("from", period.from);
    params.set("to", period.to);
    if (rep) params.set("rep", rep);
    router.replace(`/admin/sales-analytics?${params.toString()}`, { scroll: false });
  }, [tab, view, period, rep, router, leaving]);

  const onPeriodChange = useCallback((p: Period) => setPeriod(p), []);

  // Поки редірект у кабінет не відпрацював, показуємо спінер, а не зведену:
  // інакше торговий на мить бачив би таблицю на 1180px, у яку його не пускають.
  if (status === "loading" || leaving) {
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
                  Аналітика продажів
                </h1>
                <p className="truncate text-xs text-g400">
                  {isManager
                    ? "Прибуток і знижки, асортимент, клієнти, КПІ торгових"
                    : "Ваші продажі та поїздки"}
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
                onClick={() => {
                  // Ручна навігація скидає фокус мапи дня — інакше «Маршрути»
                  // відкривалися б на давно переглянутій поїздці.
                  setDayFocus(null);
                  setTarget({ tab: t.key, view: subtabsOf(t.key)?.[0].key ?? null });
                }}
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
        {subtabsOf(tab) && (
          <nav
            className="-mx-4 mb-4 flex gap-5 overflow-x-auto border-b border-g200 px-4 sm:mx-0 sm:px-0"
            aria-label="Підрозділи вкладки"
          >
            {subtabsOf(tab)!
              .filter((v) => isManager || !MANAGER_ONLY_VIEWS.includes(v.key))
              .map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => {
                    setDayFocus(null);
                    setTarget((prev) => ({ ...prev, view: v.key }));
                  }}
                  aria-current={view === v.key ? "page" : undefined}
                  className={`-mb-px shrink-0 cursor-pointer border-b-2 px-0.5 pb-2 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark ${
                    view === v.key ? "border-bk text-bk" : "border-transparent text-g500 hover:text-bk"
                  }`}
                >
                  {v.label}
                </button>
              ))}
          </nav>
        )}

        {/* Період не потрібен розділу КПІ — у планів свій вибір місяця, у схем
            мотивації дат немає. На «Маршрутах» він задає діапазон разових
            призначень, які потрапляють на карту.

            «Платники» і «Утримання» теж без нього: борг і стан клієнта — це
            залишок «на зараз», а не потік за період. Показувати там вибір
            періоду означало б обіцяти фільтр, який ні на що не впливає. */}
        {tab !== "kpi" && !(tab === "clients" && (view === "payers" || view === "cohorts")) && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <PeriodPicker value={period} onChange={onPeriodChange} />
          </div>
        )}

        {tab === "summary" && <SummaryTab period={period} />}
        {tab === "overview" && view === "sales" && (
          <OverviewTab period={period} rep={rep} onRepChange={setRep} isManager={isManager} />
        )}
        {tab === "overview" && view === "abc" && <AbcTab period={period} rep={rep} />}
        {tab === "money" && view === "profit" && <ProfitTab period={period} rep={rep} />}
        {tab === "money" && view === "discounts" && <DiscountsTab period={period} rep={rep} />}
        {tab === "reps" && view === "list" && <RepsTab period={period} />}
        {tab === "reps" && view === "benchmark" && <BenchmarkTab period={period} />}
        {tab === "reps" && view === "returns" && <ReturnsTab period={period} rep={rep} />}
        {tab === "reps" && view === "field" && <FieldWorkTab period={period} />}
        {tab === "clients" && view === "payers" && <PayersTab />}
        {tab === "clients" && view === "cohorts" && <CohortsTab />}
        {tab === "clients" && view === "basket" && <BasketTab period={period} />}
        {tab === "clients" && view === "geo" && <GeoTab period={period} />}
        {tab === "clients" && view === "map" && <ClientMapTab period={period} />}
        {tab === "kpi" && view === "plans" && <PlansTab />}
        {tab === "kpi" && view === "motivation" && <MotivationTab />}
        {tab === "kpi" && view === "payroll" && <PayrollTab />}
        {tab === "logistics" && view === "trips" && (
          <TripsTab period={period} rep={rep} onRepChange={setRep} onShowDay={openDayMap} />
        )}
        {tab === "logistics" && view === "shifts" && (
          <ShiftsTab period={period} onPeriodChange={setPeriod} />
        )}
        {tab === "logistics" && view === "routes" && <RoutesTab period={period} focus={dayFocus} />}
        {tab === "logistics" && view === "fuel" && <FuelTab period={period} />}
      </div>
    </div>
  );
}
