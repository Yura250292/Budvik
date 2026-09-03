"use client";

/**
 * Сторінка «Маршрути»: День · Журнал · Карта.
 *
 * Три екрани про одне й те саме жили в трьох місцях меню: маршрути доставки,
 * планувальник на карті й журнал листів у розділі водіїв. Логіст ходив між
 * ними й тримав у голові, де що. Тепер це вкладки одного екрана, а порядок
 * їх — порядок роботи: день (що їде сьогодні), журнал (що було), карта
 * (докладне планування).
 *
 * Стан у querystring, replace — щоб посилання на конкретний день чи маршрут
 * можна було переслати, і щоб «Назад» не гортало власні кліки.
 *
 * Вкладки рендеряться по одній. Карта всередині — Leaflet: у прихованому
 * контейнері він неправильно рахує розмір, тож тримати всі три змонтованими
 * коштувало б дорожче, ніж утрачений стан планувальника при перемиканні.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { kyivToday, PeriodPicker, type Period } from "@/components/ui/PeriodPicker";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { RouteJournal } from "@/components/routes/RouteJournal";
import RoutePlanner from "@/components/routes/RoutePlanner";
import DayTab from "./DayTab";

const TABS = [
  { key: "day", label: "День" },
  { key: "journal", label: "Журнал" },
  { key: "map", label: "Карта" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function isTab(v: string | null): v is TabKey {
  return v === "day" || v === "journal" || v === "map";
}

/** Журнал за замовчуванням дивиться на поточний місяць — як і в водіях. */
function defaultPeriod(): Period {
  const today = kyivToday();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

export default function RoutesShell() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useSearchParams();

  // Стан читаємо з URL один раз: далі ним володіє сторінка, інакше кожен
  // replace смикав би компоненти вкладок.
  const [tab, setTab] = useState<TabKey>(() => (isTab(params.get("tab")) ? (params.get("tab") as TabKey) : "day"));
  const [day, setDay] = useState(() => params.get("day") ?? kyivToday());
  const [driverId, setDriverId] = useState<string | null>(() => params.get("driver"));
  const [openId, setOpenId] = useState<string | null>(() => params.get("routeId"));
  const [period, setPeriod] = useState<Period>(() => {
    const from = params.get("from");
    const to = params.get("to");
    return from && to ? { from, to } : defaultPeriod();
  });
  const [plannerRouteId, setPlannerRouteId] = useState<string | null>(() => params.get("deliveryRouteId"));

  useEffect(() => {
    const next = new URLSearchParams();
    if (tab !== "day") next.set("tab", tab);
    if (tab === "day") {
      if (day !== kyivToday()) next.set("day", day);
      if (driverId) next.set("driver", driverId);
      if (openId) next.set("routeId", openId);
    } else if (tab === "journal") {
      next.set("from", period.from);
      next.set("to", period.to);
    } else if (plannerRouteId) {
      next.set("deliveryRouteId", plannerRouteId);
    }
    const qs = next.toString();
    router.replace(`/admin/erp/delivery-routes${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [tab, day, driverId, openId, period, plannerRouteId, router]);

  const role = (session?.user as { role?: string } | undefined)?.role;

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
        <CardSkeleton rows={3} title />
      </div>
    );
  }

  if (!role || !["ADMIN", "MANAGER"].includes(role)) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Доступ заборонено</h1>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
      <div>
        <h1 className="text-xl font-bold text-bk sm:text-2xl">Маршрути</h1>
        <p className="mt-0.5 text-sm text-g500">Листи 1С, планування, передача водіям</p>
      </div>

      <nav className="-mx-4 mb-4 mt-3 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="Розділи маршрутів">
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

      {tab === "day" && (
        <DayTab
          day={day}
          driverId={driverId}
          openId={openId}
          onOpenMap={(routeId) => {
            setPlannerRouteId(routeId);
            setTab("map");
          }}
          onDayChange={(d) => {
            setDay(d);
            // Розгорнута картка належала попередньому дню — у новому її немає.
            setOpenId(null);
          }}
          onDriverChange={setDriverId}
          onOpenChange={setOpenId}
        />
      )}

      {tab === "journal" && (
        <div className="space-y-4">
          <PeriodPicker value={period} onChange={setPeriod} />
          <RouteJournal period={period} />
        </div>
      )}

      {tab === "map" && <RoutePlanner deliveryRouteId={plannerRouteId} />}
    </div>
  );
}
