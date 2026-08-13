"use client";

/**
 * Планшет у машині: карта дня + чек-ліст клієнтів + запис треку.
 *
 * Головний екран водія на весь день. Планшет стоїть у тримачі, вкладка
 * не згортається — саме тому тут (а не в боті) збирається трек.
 *
 * Верстка розходиться за орієнтацією: на альбомній карта і список поруч
 * (у машині планшет майже завжди лежить горизонтально), на портретній
 * список стає нижньою панеллю. Кнопки великі: у них цілять пальцем, іноді
 * на ходу.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useTrackRecorder } from "@/hooks/useTrackRecorder";
import { useBuildVersion } from "@/hooks/useBuildVersion";
import type { RouteLine, TabletStop } from "@/components/map/TabletDayMap";

const TabletDayMap = dynamic(() => import("@/components/map/TabletDayMap"), {
  ssr: false,
  loading: () => <div style={{ height: "100%", width: "100%", background: "#E5E7EB" }} />,
});

type DayResp = {
  day: string;
  role: string;
  route: {
    source: "ROUTE_SHEET" | "DELIVERY_ROUTE" | "NONE";
    number: string | null;
    vehicle: string | null;
    plannedKm: number | null;
    geometry: RouteLine;
    stops: TabletStop[];
  };
  progress: {
    total: number;
    done: number;
    missed: number;
    left: number;
    collected: number;
    debtPlanned: number;
  };
  track: {
    distanceKm: number;
    pointsCount: number;
    lastPointAt: string | null;
    path: Array<[number, number]>;
  };
};

type RouteVariant = {
  order: string[];
  distanceKm: number;
  durationMin: number;
  fuelCost: number;
  geometry: RouteLine;
  stops: Array<{ key: string; name: string; reason: string; score: number }>;
};

/** Активна навігація до однієї точки. */
type NavState = {
  stopKey: string;
  name: string;
  lat: number;
  lng: number;
  distanceKm: number;
  durationMin: number;
  geometry: RouteLine;
};

type OptimizeResp = {
  cheapest: RouteVariant;
  balanced: RouteVariant | null;
  detourPercent: number;
  extraCost: number;
  startName: string | null;
  startedFromFirstStop: boolean;
};

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/** Що показує індикатор треку в шапці. */
const TRACK_BADGE: Record<string, { dot: string; label: string }> = {
  live: { dot: "#16A34A", label: "Трек іде" },
  buffering: { dot: "#D97706", label: "Немає звʼязку" },
  denied: { dot: "#DC2626", label: "Немає доступу до GPS" },
  unsupported: { dot: "#DC2626", label: "GPS недоступний" },
  idle: { dot: "#9CA3AF", label: "Трек вимкнено" },
};

export default function DriverTabletPage() {
  const [data, setData] = useState<DayResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStop, setOpenStop] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // Побудова маршруту: null — ще не рахували, далі два варіанти на вибір
  const [plan, setPlan] = useState<OptimizeResp | null>(null);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState<"cheapest" | "balanced" | null>(null);
  /** Попередній перегляд лінії варіанта, поки водій вибирає */
  const [previewGeom, setPreviewGeom] = useState<RouteLine>(null);
  /** Навігація до однієї точки: лінія на нашій карті, не Google Maps */
  const [nav, setNav] = useState<NavState | null>(null);
  const [navigating, setNavigating] = useState<string | null>(null);

  const track = useTrackRecorder({ enabled: true });
  const build = useBuildVersion();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tablet/day");
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      setData(json as DayResp);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити день");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Трек на карті — це збережене з сервера плюс те, що набралося вже в
   * цій сесії. Інакше лінія «наздоганяла» б водія лише після
   * перезавантаження сторінки.
   */
  const fullTrail = useMemo(
    () => [...(data?.track.path ?? []), ...track.trail],
    [data?.track.path, track.trail]
  );

  const mark = useCallback(
    async (
      stop: TabletStop,
      status: "DONE" | "MISSED",
      money_: "FULL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE",
      extra?: { collectedAmount?: number; comment?: string }
    ) => {
      // Бонусна поїздка не має клієнта, а візит без клієнта неможливий
      // (@@unique [userId, day, counterpartyId]) — для неї станом служить
      // сам DeliveryStop.
      const isErrandStop = stop.kind !== "DELIVERY";
      if (!isErrandStop && !stop.counterpartyId) return;

      setSaving(stop.key);
      try {
        const res = isErrandStop
          ? await fetch(`/api/erp/delivery-routes/stop/${stop.key.slice(3)}/mark`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                status: status === "DONE" ? "DELIVERED" : "FAILED",
                comment: extra?.comment,
              }),
            })
          : await fetch("/api/visits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            counterpartyId: stop.counterpartyId,
            status,
            money: money_,
            debtAmount: stop.debtAmount,
            collectedAmount: extra?.collectedAmount,
            comment: extra?.comment,
            routeSheetStopId: stop.key.startsWith("rs:") ? stop.key.slice(3) : null,
            deliveryStopId: stop.key.startsWith("ds:") ? stop.key.slice(3) : null,
            // Де стоїть планшет у мить відмітки — доказ присутності
            lat: track.position?.lat ?? null,
            lng: track.position?.lng ?? null,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.error ?? "Не вдалося зберегти");
        }
        await load();
        setOpenStop(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не вдалося зберегти відмітку");
      } finally {
        setSaving(null);
      }
    },
    [load, track.position]
  );

  /**
   * Прокласти маршрут від того місця, де водій стоїть зараз.
   *
   * Саме від поточної позиції, а не від складу: водій тисне цю кнопку
   * посеред дня, коли половина точок уже позаду, і маршрут «зі складу»
   * був би йому марний.
   */
  const buildPlan = useCallback(async () => {
    setPlanning(true);
    setError(null);
    try {
      const res = await fetch("/api/routes/optimize-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: track.position ? [track.position.lng, track.position.lat] : undefined,
        }),
      });
      // Сесія протухла за ніч у тримачі — сервер віддає HTML логіна, і
      // json() падає. Кажемо прямо, замість мовчазного «нічого не сталось».
      if (res.status === 401) throw new Error("Сесія завершилась — увійдіть знову");
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      if (!json?.cheapest) throw new Error("Сервер не повернув маршрут");
      const built = json as OptimizeResp;
      setPlan(built);
      // Одразу показуємо лінію найдешевшого: «прокласти маршрут» без
      // лінії на карті виглядає як кнопка, що не спрацювала.
      setPreviewGeom(built.cheapest.geometry ?? null);
    } catch (e) {
      // TypeError від fetch — це або немає мережі, або сторінка стара і
      // не може довантажити свої чанки після деплою.
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      setError(
        e instanceof TypeError
          ? offline
            ? "Немає звʼязку — маршрут порахується, коли зʼявиться інтернет"
            : "Звʼязок обірвався. Якщо повторюється — перезавантажте сторінку"
          : e instanceof Error
            ? e.message
            : "Не вдалося прокласти маршрут"
      );
    } finally {
      setPlanning(false);
    }
  }, [track.position]);

  /** Застосувати обраний варіант — переставити точки в маршруті дня. */
  const applyPlan = useCallback(
    async (which: "cheapest" | "balanced") => {
      const variant = which === "cheapest" ? plan?.cheapest : plan?.balanced;
      if (!variant) return;
      setApplying(which);
      try {
        const res = await fetch("/api/routes/apply-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order: variant.order,
            distanceKm: variant.distanceKm,
            fuelCost: variant.fuelCost,
            geometry: variant.geometry,
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти порядок");
        setPlan(null);
        setPreviewGeom(null);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не вдалося зберегти порядок");
      } finally {
        setApplying(null);
      }
    },
    [plan, load]
  );

  /**
   * Навігація до точки — лінія на нашій карті замість Google Maps.
   *
   * Вихід у зовнішній застосунок відправляє вкладку у фон і рве трек;
   * дорога, намальована тут, тримає планшет у вебі. Google Maps лишився
   * запасним лінком у банері — для голосових підказок.
   */
  const navigateTo = useCallback(
    async (stop: TabletStop) => {
      if (stop.lat == null || stop.lng == null) return;
      setNavigating(stop.key);
      setError(null);
      try {
        // Позиція: свіжа з трекера, інакше разовий запит до GPS.
        let from = track.position;
        if (!from) {
          from = await new Promise((resolve) =>
            navigator.geolocation?.getCurrentPosition(
              (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
              () => resolve(null),
              { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
            ) ?? resolve(null)
          );
        }
        if (!from) {
          throw new Error("Немає вашої позиції — дозвольте геолокацію і спробуйте ще раз");
        }

        const res = await fetch("/api/routes/navigate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: [from.lng, from.lat], to: [stop.lng, stop.lat] }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? "Не вдалося прокласти дорогу");

        setNav({
          stopKey: stop.key,
          name: stop.name,
          lat: stop.lat,
          lng: stop.lng,
          distanceKm: json.distanceKm,
          durationMin: json.durationMin,
          geometry: json.geometry,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не вдалося прокласти дорогу");
      } finally {
        setNavigating(null);
      }
    },
    [track.position]
  );

  const badge = TRACK_BADGE[track.status] ?? TRACK_BADGE.idle;
  const stops = data?.route.stops ?? [];
  /** Лінія плану: попередній перегляд варіанта має пріоритет над збереженою */
  const plannedLine = previewGeom ?? data?.route.geometry ?? null;

  return (
    <div
      className="fixed inset-x-0 top-0 flex flex-col"
      style={{
        // Низ — над нижнім меню водія. Раніше карта займала весь екран, і
        // меню на ній не було взагалі: водій не мав куди піти з карти дня.
        bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))",
        background: "#F3F4F6",
        overscrollBehavior: "none",
      }}
    >
      {/* Шапка: маршрут, прогрес, стан треку.
          Цифри великі — на них дивляться скоса, тримаючи кермо. */}
      <header
        className="shrink-0"
        style={{
          background: "#0A0A0A",
          color: "#fff",
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div className="flex items-center gap-3 px-4" style={{ height: "56px" }}>
          <div className="min-w-0">
            <p
              className="truncate"
              style={{ fontSize: "15px", fontWeight: 700, lineHeight: 1.2 }}
            >
              {data?.route.number ? `Маршрут ${data.route.number}` : "Маршрут на сьогодні"}
            </p>
            {data && data.progress.total > 0 && (
              <p style={{ fontSize: "12px", color: "#9CA3AF", lineHeight: 1.3 }}>
                {data.progress.done + data.progress.missed} з {data.progress.total} точок
                {data.progress.debtPlanned > 0 && (
                  <>
                    {" · "}
                    <span style={{ color: "#4ADE80" }}>
                      {money.format(data.progress.collected)}
                    </span>
                    {" / "}
                    {money.format(data.progress.debtPlanned)} ₴
                  </>
                )}
              </p>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3 text-right">
            <div>
              <p style={{ fontSize: "17px", fontWeight: 700, lineHeight: 1.1 }}>
                {track.distanceKm || data?.track.distanceKm || 0}
                <span style={{ fontSize: "12px", color: "#9CA3AF", fontWeight: 400 }}> км</span>
              </p>
              <p
                className="flex items-center justify-end gap-1.5"
                style={{ fontSize: "11px", color: "#D1D5DB", lineHeight: 1.3 }}
              >
                <span
                  aria-hidden
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    background: badge.dot,
                    display: "inline-block",
                  }}
                />
                {badge.label}
                {track.pending > 0 && <span style={{ color: "#FB923C" }}>+{track.pending}</span>}
              </p>
            </div>

            {/* Кнопки виходу тут немає: перехід між розділами водій робить
                нижнім меню, однаковим на всіх екранах. */}
          </div>
        </div>

        {/* Смужка прогресу: єдиний елемент, який читається боковим зором */}
        {data && data.progress.total > 0 && (
          <div
            role="progressbar"
            aria-valuenow={data.progress.done + data.progress.missed}
            aria-valuemin={0}
            aria-valuemax={data.progress.total}
            aria-label="Пройдено точок маршруту"
            style={{ height: "3px", background: "#1F2937", display: "flex" }}
          >
            <span
              style={{
                width: `${(data.progress.done / data.progress.total) * 100}%`,
                background: "#16A34A",
                transition: "width .3s",
              }}
            />
            <span
              style={{
                width: `${(data.progress.missed / data.progress.total) * 100}%`,
                background: "#DC2626",
                transition: "width .3s",
              }}
            />
          </div>
        )}
      </header>

      {/* Вийшов деплой під відкритою вкладкою: стара сторінка не може
          довантажити свої чанки, і кнопки тихо перестають працювати.
          Пропонуємо оновитись, але не робимо це самі — щоб не стерти
          недописану відмітку візиту. */}
      {build.stale && (
        <button
          type="button"
          onClick={build.reload}
          className="shrink-0 cursor-pointer transition-colors duration-200"
          style={{
            width: "100%",
            minHeight: "44px",
            border: "none",
            background: "#FFD600",
            color: "#0A0A0A",
            fontSize: "14px",
            fontWeight: 700,
          }}
        >
          Вийшло оновлення — натисніть, щоб перезавантажити
        </button>
      )}

      {error && (
        <div
          className="flex shrink-0 items-center gap-2 px-4 py-2.5"
          style={{ background: "#DC2626" }}
        >
          <p className="flex-1" style={{ fontSize: "13.5px", fontWeight: 600, color: "#fff" }}>
            {error}
          </p>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Закрити помилку"
            className="shrink-0 cursor-pointer rounded-lg"
            style={{
              minWidth: "44px",
              minHeight: "36px",
              border: "none",
              background: "rgba(255,255,255,0.2)",
              color: "#fff",
              fontSize: "15px",
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Карта + чек-ліст. На альбомній — поруч на всю висоту, на
          портретній — одне під одним. Планшет у машині майже завжди
          горизонтально, але тримач буває й вертикальний.

          min-h-0 на обох дітях обов'язковий: без нього flex-елемент не
          дає внутрішньому списку скролитися і той розтягує сторінку. */}
      <div className="flex min-h-0 flex-1 flex-col landscape:flex-row">
        <div className="relative min-h-0 flex-1 landscape:h-full">
          <TabletDayMap
            stops={stops}
            trail={fullTrail}
            me={track.position}
            planned={plannedLine}
            nav={nav?.geometry ?? null}
            onNavigate={(key) => {
              const s = stops.find((x) => x.key === key);
              if (s) void navigateTo(s);
            }}
          />

          {/* Банер активної навігації поверх карти */}
          {nav && (
            <div
              className="absolute inset-x-3 z-[500] flex items-center gap-2 rounded-2xl px-3 py-2.5"
              style={{
                bottom: "12px",
                background: "#0A0A0A",
                color: "#fff",
                boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
              }}
            >
              <span
                aria-hidden
                className="shrink-0"
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  background: "#F97316",
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate" style={{ fontSize: "14px", fontWeight: 700 }}>
                  {nav.name}
                </span>
                <span style={{ fontSize: "12px", color: "#9CA3AF" }}>
                  {nav.distanceKm} км · ~{nav.durationMin} хв
                </span>
              </span>
              {/* Запасний вихід для голосових підказок — свідомо дрібний */}
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${nav.lat},${nav.lng}`}
                target="_blank"
                rel="noopener"
                className="shrink-0 cursor-pointer rounded-lg px-2.5 py-2"
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#93C5FD",
                  textDecoration: "none",
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              >
                Google
              </a>
              <button
                type="button"
                onClick={() => setNav(null)}
                aria-label="Завершити навігацію"
                className="shrink-0 cursor-pointer rounded-lg transition-colors duration-200"
                style={{
                  minWidth: "44px",
                  minHeight: "40px",
                  border: "none",
                  background: "rgba(255,255,255,0.12)",
                  color: "#fff",
                  fontSize: "15px",
                  fontWeight: 700,
                }}
              >
                ✕
              </button>
            </div>
          )}
        </div>

        <aside
          className="flex min-h-0 shrink-0 flex-col overflow-y-auto landscape:h-full landscape:w-[400px] landscape:max-h-none"
          style={{
            background: "#fff",
            borderTop: "1px solid #E5E7EB",
            // Портретна орієнтація: список бере половину екрана, карта
            // лишається читабельною. В альбомній стелю знімає клас вище.
            maxHeight: "50vh",
            WebkitOverflowScrolling: "touch",
            overscrollBehavior: "contain",
          }}
        >
          {!data ? (
            <p className="px-4 py-6" style={{ color: "#9CA3AF", fontSize: "14px" }}>
              Завантаження…
            </p>
          ) : stops.length === 0 ? (
            <div className="px-4 py-6">
              <p style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A" }}>
                Маршрут на сьогодні ще не передано
              </p>
              <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "6px", lineHeight: 1.5 }}>
                Логіст ще складає список. Точки зʼявляться, щойно маршрут
                передадуть вам — трек тим часом усе одно записується.
              </p>
            </div>
          ) : (
            <>
              <BuildRouteButton
                planning={planning}
                hasPosition={!!track.position}
                onBuild={buildPlan}
              />

              {stops.map((s) => (
                <StopRow
                  key={s.key}
                  stop={s}
                  open={openStop === s.key}
                  saving={saving === s.key}
                  navigating={navigating === s.key}
                  onToggle={() => setOpenStop(openStop === s.key ? null : s.key)}
                  onMark={mark}
                  onNavigate={(x) => void navigateTo(x)}
                />
              ))}
            </>
          )}
        </aside>
      </div>

      {/* Варіанти маршруту — шаром поверх усього екрана.
          Раніше панель була всередині списку точок: на портретному
          планшеті вона опинялася нижче карти, і водій, натиснувши
          «Прокласти маршрут», бачив «нічого не сталося». */}
      {plan && (
        <RoutePlanner
          plan={plan}
          applying={applying}
          onApply={applyPlan}
          onPreview={(g) => setPreviewGeom(g)}
          onDismiss={() => {
            setPlan(null);
            setPreviewGeom(null);
          }}
        />
      )}
    </div>
  );
}

/** Кнопка запуску розрахунку — живе в списку, поруч із точками. */
function BuildRouteButton({
  planning,
  hasPosition,
  onBuild,
}: {
  planning: boolean;
  hasPosition: boolean;
  onBuild: () => void;
}) {
  return (
    <div style={{ padding: "10px 16px", borderBottom: "1px solid #F3F4F6" }}>
      {/* Заливка, а не рамка: на сонці бліда кнопка читається як
          неактивна, і водій тисне її вдруге, думаючи, що не спрацювало. */}
      <button
        type="button"
        onClick={onBuild}
        disabled={planning}
        className="w-full cursor-pointer transition-colors duration-200"
        style={{
          minHeight: "48px",
          padding: "12px",
          borderRadius: "12px",
          border: "none",
          background: planning ? "#93C5FD" : "#2563EB",
          color: "#fff",
          fontSize: "15px",
          fontWeight: 700,
        }}
      >
        {planning ? "Рахую маршрут…" : "Прокласти маршрут"}
      </button>
      <p style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "6px", lineHeight: 1.45 }}>
        {hasPosition
          ? "Порахую від місця, де ви зараз."
          : "Увімкніть геолокацію, щоб рахувати від вашого місця."}
      </p>
    </div>
  );
}

/**
 * Побудова маршруту: дві пропозиції з цінами.
 *
 * Вибір показуємо ЗАВЖДИ, коли варіанти різні, і завжди з різницею в
 * гривнях. Автоматично застосувати «розумніший» порядок було б спокусливо,
 * але водій має бачити, за що платить: гак заради боржника коштує пального,
 * і це рішення людини, а не алгоритму.
 */
function RoutePlanner({
  plan,
  applying,
  onApply,
  onPreview,
  onDismiss,
}: {
  plan: OptimizeResp;
  applying: "cheapest" | "balanced" | null;
  onApply: (which: "cheapest" | "balanced") => void;
  /** Тап по картці варіанта — показати його лінію на карті */
  onPreview: (geometry: RouteLine) => void;
  onDismiss: () => void;
}) {

  const { cheapest, balanced, detourPercent, extraCost } = plan;
  // Пріоритетні точки, які підтягнув балансир — саме їх водій має
  // побачити, щоб зрозуміти, за що доплачує.
  const highlights = (balanced?.stops ?? [])
    .slice(0, 3)
    .filter((s) => s.score >= 0.35);

  return (
    // Затемнення на весь екран: результат розрахунку не має ховатися
    // нижче карти, а тап повз панель — це «передумав».
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center"
      style={{ background: "rgba(10,10,10,0.45)" }}
      onClick={onDismiss}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full overflow-y-auto"
        style={{
          maxWidth: "560px",
          maxHeight: "85vh",
          background: "#F8FAFC",
          borderTopLeftRadius: "18px",
          borderTopRightRadius: "18px",
          // Нижнє меню водія накриває низ екрана — піднімаємо над ним,
          // інакше остання кнопка вибору опиняється під навбаром.
          padding: "14px 16px calc(16px + 4rem + env(safe-area-inset-bottom, 0px))",
          boxShadow: "0 -4px 24px rgba(0,0,0,0.3)",
        }}
      >
      <div className="mb-3 flex items-center justify-between">
        <span style={{ fontSize: "16px", fontWeight: 700, color: "#0A0A0A" }}>
          Оберіть маршрут
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Закрити вибір маршруту"
          className="cursor-pointer transition-colors duration-200"
          style={{
            minWidth: "44px",
            minHeight: "44px",
            border: "none",
            background: "none",
            color: "#6B7280",
            fontSize: "14px",
            fontWeight: 600,
          }}
        >
          Скасувати
        </button>
      </div>

      <VariantCard
        title="Найдешевший"
        distanceKm={cheapest.distanceKm}
        durationMin={cheapest.durationMin}
        fuelCost={cheapest.fuelCost}
        accent="#16A34A"
        note="Мінімум кілометрів · тапніть, щоб побачити лінію"
        busy={applying === "cheapest"}
        disabled={applying !== null}
        onApply={() => onApply("cheapest")}
        onPreview={() => onPreview(cheapest.geometry)}
      />

      {balanced && (
        <div style={{ marginTop: "8px" }}>
          <VariantCard
            title="З пріоритетами"
            distanceKm={balanced.distanceKm}
            durationMin={balanced.durationMin}
            fuelCost={balanced.fuelCost}
            accent="#F97316"
            note={
              extraCost > 0
                ? `Довше на ${detourPercent}% · дорожче на ${money.format(extraCost)} ₴`
                : "Той самий пробіг, кращий порядок"
            }
            busy={applying === "balanced"}
            disabled={applying !== null}
            onApply={() => onApply("balanced")}
            onPreview={() => onPreview(balanced.geometry)}
          />
          {highlights.length > 0 && (
            <ul style={{ margin: "6px 0 0", padding: "0 0 0 14px", listStyle: "disc" }}>
              {highlights.map((h) => (
                <li key={h.key} style={{ fontSize: "11.5px", color: "#6B7280", lineHeight: 1.5 }}>
                  <strong style={{ color: "#374151" }}>{h.name}</strong> раніше — {h.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!balanced && (
        <p style={{ fontSize: "11.5px", color: "#6B7280", marginTop: "8px", lineHeight: 1.45 }}>
          Найкоротший маршрут уже обслуговує важливих клієнтів вчасно —
          окремий варіант не потрібен.
        </p>
      )}
      </div>
    </div>
  );
}

/** Картка одного варіанта маршруту: цифри великі, кнопка під палець. */
function VariantCard({
  title,
  distanceKm,
  durationMin,
  fuelCost,
  accent,
  note,
  busy,
  disabled,
  onApply,
  onPreview,
}: {
  title: string;
  distanceKm: number;
  durationMin: number;
  fuelCost: number;
  accent: string;
  note: string;
  busy: boolean;
  disabled: boolean;
  onApply: () => void;
  onPreview: () => void;
}) {
  return (
    // Тап по тілу картки показує лінію варіанта на карті — водій бачить,
    // КУДИ його поведе кожен варіант, ще до вибору.
    <div
      onClick={onPreview}
      className="cursor-pointer"
      style={{
        background: "#fff",
        border: `1px solid ${accent}33`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: "10px",
        padding: "10px 12px",
      }}
    >
      <div className="flex items-baseline gap-2">
        <span style={{ fontSize: "14px", fontWeight: 700, color: "#0A0A0A" }}>{title}</span>
        <span style={{ fontSize: "13px", color: "#6B7280" }}>
          {distanceKm} км · {Math.round(durationMin / 60)} год {durationMin % 60} хв
        </span>
        <span style={{ marginLeft: "auto", fontSize: "16px", fontWeight: 700, color: accent }}>
          {money.format(fuelCost)} ₴
        </span>
      </div>
      <p style={{ fontSize: "11.5px", color: "#6B7280", margin: "3px 0 8px", lineHeight: 1.4 }}>
        {note}
      </p>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation(); // тап по кнопці — вибір, а не превʼю картки
          onApply();
        }}
        disabled={disabled}
        className="w-full cursor-pointer transition-colors duration-200"
        style={{
          minHeight: "44px",
          borderRadius: "8px",
          border: "none",
          background: busy ? "#E5E7EB" : accent,
          color: busy ? "#6B7280" : "#fff",
          fontSize: "14px",
          fontWeight: 700,
          opacity: disabled && !busy ? 0.5 : 1,
        }}
      >
        {busy ? "Застосовую…" : "Обрати цей"}
      </button>
    </div>
  );
}

/** Рядок чек-ліста: згорнутий — статус, розгорнутий — кнопки й гроші. */
function StopRow({
  stop,
  open,
  saving,
  navigating,
  onToggle,
  onMark,
  onNavigate,
}: {
  stop: TabletStop;
  open: boolean;
  saving: boolean;
  navigating: boolean;
  onToggle: () => void;
  onMark: (
    stop: TabletStop,
    status: "DONE" | "MISSED",
    money: "FULL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE",
    extra?: { collectedAmount?: number; comment?: string }
  ) => void;
  onNavigate: (stop: TabletStop) => void;
}) {
  const [partial, setPartial] = useState("");
  const [comment, setComment] = useState("");

  const done = stop.visit?.status === "DONE";
  const missed = stop.visit?.status === "MISSED";
  // У бонусній поїздці нічого не везуть і нічого не забирають грішми:
  // ховаємо суми й блок інкасації, лишаємо саму справу.
  const isErrand = stop.kind !== "DELIVERY";
  const hasDebt = !isErrand && stop.debtAmount > 0;

  return (
    <div
      style={{
        borderBottom: "1px solid #F3F4F6",
        background: done ? "#F0FDF4" : missed ? "#FEF2F2" : isErrand ? "#FFFDF5" : "#fff",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 text-left"
        style={{ background: "none", border: "none", padding: "12px 16px" }}
      >
        <span
          className="flex shrink-0 items-center justify-center rounded-full"
          style={{
            width: "28px",
            height: "28px",
            background: done ? "#16A34A" : missed ? "#DC2626" : "#E5E7EB",
            color: done || missed ? "#fff" : "#374151",
            fontSize: "13px",
            fontWeight: 700,
          }}
        >
          {done ? "✓" : missed ? "×" : stop.sequence}
        </span>

        <span className="min-w-0 flex-1">
          <span
            className="block truncate"
            style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A" }}
          >
            {isErrand && <span style={{ marginRight: "5px" }}>{stop.kind === "PICKUP" ? "↩️" : "✳️"}</span>}
            {stop.name}
          </span>
          {stop.address && (
            <span
              className="block truncate"
              style={{ fontSize: "12px", color: "#6B7280", marginTop: "1px" }}
            >
              {stop.address}
            </span>
          )}
          {stop.notes && (
            <span
              className="block"
              style={{ fontSize: "12px", color: "#92400E", marginTop: "2px" }}
            >
              {stop.notes}
            </span>
          )}
          <span className="flex flex-wrap items-center gap-2" style={{ marginTop: "3px" }}>
            {isErrand && (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#92400E",
                  background: "#FEF3C7",
                  padding: "1px 6px",
                  borderRadius: "4px",
                }}
              >
                {stop.kind === "PICKUP" ? "ЗАБРАТИ" : "ДОРУЧЕННЯ"}
              </span>
            )}
            {!isErrand && stop.amount > 0 && (
              <span style={{ fontSize: "12px", color: "#374151" }}>
                {money.format(stop.amount)} грн
              </span>
            )}
            {hasDebt && (
              <span style={{ fontSize: "12px", color: "#DC2626", fontWeight: 600 }}>
                борг {money.format(stop.debtAmount)}
              </span>
            )}
            {stop.visit?.collectedAmount != null && stop.visit.collectedAmount > 0 && (
              <span style={{ fontSize: "12px", color: "#16A34A", fontWeight: 600 }}>
                забрано {money.format(stop.visit.collectedAmount)}
              </span>
            )}
            {stop.geoSource !== "MANUAL" && stop.lat != null && (
              <span style={{ fontSize: "11px", color: "#D97706" }}>точка приблизна</span>
            )}
          </span>
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {/* Головні дві кнопки — великі, поруч: приїхав / не потрапив */}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                onMark(stop, "DONE", hasDebt ? "FULL" : "NOT_APPLICABLE", {
                  comment: comment || undefined,
                })
              }
              style={{
                flex: 1,
                padding: "14px",
                borderRadius: "12px",
                border: "none",
                background: "#16A34A",
                color: "#fff",
                fontSize: "15px",
                fontWeight: 700,
                opacity: saving ? 0.5 : 1,
              }}
            >
              {hasDebt
                ? `Приїхав, забрав ${money.format(stop.debtAmount)}`
                : isErrand
                  ? "Зробив"
                  : "Приїхав"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => onMark(stop, "MISSED", "NOT_APPLICABLE", { comment: comment || undefined })}
              style={{
                flex: 1,
                padding: "14px",
                borderRadius: "12px",
                border: "none",
                background: "#DC2626",
                color: "#fff",
                fontSize: "15px",
                fontWeight: 700,
                opacity: saving ? 0.5 : 1,
              }}
            >
              {isErrand ? "Не вийшло" : "Не потрапив"}
            </button>
          </div>

          {/* Гроші: тільки якщо є що забирати */}
          {hasDebt && (
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => onMark(stop, "DONE", "NONE", { comment: comment || undefined })}
                style={{
                  flex: 1,
                  padding: "11px",
                  borderRadius: "10px",
                  border: "1px solid #E5E7EB",
                  background: "#fff",
                  fontSize: "14px",
                  fontWeight: 600,
                  color: "#374151",
                }}
              >
                Не забрав нічого
              </button>
              <input
                inputMode="decimal"
                value={partial}
                onChange={(e) => setPartial(e.target.value.replace(/[^\d.,]/g, ""))}
                placeholder="Сума"
                style={{
                  width: "96px",
                  padding: "11px",
                  borderRadius: "10px",
                  border: "1px solid #E5E7EB",
                  fontSize: "15px",
                  textAlign: "center",
                }}
              />
              <button
                type="button"
                disabled={saving || !partial}
                onClick={() =>
                  onMark(stop, "DONE", "PARTIAL", {
                    collectedAmount: Number(partial.replace(",", ".")),
                    comment: comment || undefined,
                  })
                }
                style={{
                  padding: "11px 16px",
                  borderRadius: "10px",
                  border: "none",
                  background: partial ? "#0A0A0A" : "#E5E7EB",
                  color: partial ? "#fff" : "#9CA3AF",
                  fontSize: "14px",
                  fontWeight: 700,
                }}
              >
                ОК
              </button>
            </div>
          )}

          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Коментар: магазин закритий, немає грошей…"
            style={{
              width: "100%",
              marginTop: "8px",
              padding: "11px",
              borderRadius: "10px",
              border: "1px solid #E5E7EB",
              fontSize: "14px",
            }}
          />

          {stop.visit?.status && (
            <p style={{ fontSize: "12px", color: "#6B7280", marginTop: "8px" }}>
              Відмічено. Натисніть іншу кнопку, щоб виправити.
            </p>
          )}

          {stop.lat != null && stop.lng != null && (
            // Кнопка, а не лінк на Google Maps: дорога малюється на нашій
            // карті, і вкладка з треком не йде у фон.
            <button
              type="button"
              disabled={navigating}
              onClick={() => onNavigate(stop)}
              className="w-full cursor-pointer transition-colors duration-200"
              style={{
                display: "block",
                marginTop: "8px",
                padding: "12px",
                borderRadius: "10px",
                border: "none",
                background: navigating ? "#93C5FD" : "#2563EB",
                color: "#fff",
                textAlign: "center",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              {navigating ? "Прокладаю дорогу…" : "Навігація до точки"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
