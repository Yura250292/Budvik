"use client";

/**
 * Карта водія: клієнти й відкритий маршрутний лист.
 *
 * Та сама карта, що в торгового, але портфель інший: у водія немає
 * закріплених клієнтів — його точки це ті, куди він реально їздив. І
 * задача інша: торговий шукає, до кого заїхати, водій — де саме той
 * магазин, до якого він їде вперше.
 *
 * Поверх клієнтів лежить шар маршруту. Раніше він був єдиний і мовчазний:
 * підсвічувалися точки САМЕ СЬОГОДНІШНЬОГО дня, і тільки вони — вчорашній
 * лист чи переданий на завтра подивитися на карті було ніяк. Тепер лист
 * обирається в шторці, а карта показує його номерними пінами в порядку
 * обʼїзду.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CLIENT_STATE, type ClientStateKey } from "@/lib/analytics/colors";
import { ClientOrderModal } from "@/app/admin/sales-analytics/components/ClientOrderModal";
import { ClientCommentsModal } from "@/app/admin/sales-analytics/components/ClientCommentsModal";
import { DriverPinModal } from "@/components/driver/DriverPinModal";
import { RouteChip, RouteSheet, formatRouteDay } from "@/components/driver/RoutePicker";
import { pointUrl } from "@/lib/maps/google-links";
import { kyivToday } from "@/components/ui/PeriodPicker";
import type { DayStop } from "@/lib/track/day-stop-type";
import { planCore } from "@/components/map/SalesClientsMap";
import type { DayPlan, PlanStop, SalesClientPoint } from "@/components/map/SalesClientsMap";

const SalesClientsMap = dynamic(() => import("@/components/map/SalesClientsMap"), {
  ssr: false,
  loading: () => <div style={{ height: "100%", width: "100%", background: "#E5E7EB" }} />,
});

type DriverClient = SalesClientPoint & {
  visits: number;
  lastVisitAt: string | null;
  today: boolean;
  mine: boolean;
};

type Resp = {
  day: string;
  clients: DriverClient[];
  counts: Record<string, number>;
  todayCount: number;
  mineCount: number;
  approximateCount: number;
};

/** Відповідь /api/tablet/day — беремо з неї лише маршрут. */
type DayResp = {
  day: string;
  route: {
    id: string | null;
    day: string | null;
    number: string | null;
    vehicle: string | null;
    geometry: { type: string; coordinates: [number, number][] } | null;
    stops: DayStop[];
  };
};

/**
 * Що показувати на карті. Раніше вибірка була жорстко «мої» — і новий
 * водій бачив рівно сьогоднішній виїзд, тобто порожню карту.
 */
type Scope = "route" | "mine" | "all";

const LEGEND: ClientStateKey[] = ["ACTIVE", "NEW", "SLIPPING", "DORMANT", "LOST"];

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/** Стан точки маршруту так, як його малює карта. */
function planStatus(stop: DayStop): PlanStop["status"] {
  if (stop.visit?.status === "DONE") return "DONE";
  if (stop.visit?.status === "MISSED") return "MISSED";
  return "PENDING";
}

export default function DriverMapScreen() {
  const router = useRouter();
  const params = useSearchParams();
  /** null — сьогоднішній маршрут, який сервер знайде сам. */
  const routeKey = params.get("route");
  /**
   * Доба без номера листа — так приходять з історії маршрутів, де рядок
   * знає лише дату. Ключ маршруту сильніший: якщо він є, дата зайва.
   */
  const dayKey = routeKey ? null : params.get("day");

  const [data, setData] = useState<Resp | null>(null);
  const [day, setDay] = useState<DayResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  /**
   * null — водій ще не вибирав сам.
   *
   * Тоді обсяг диктує маршрут: відкрив лист — бачить його точки, немає
   * листа — усю базу. Раніше замовчуванням було жорстке «всі», і 26 пінів
   * маршруту губилися серед трьох тисяч кружечків. Щойно людина тапнула
   * сегмент — її вибір головніший, і сам він більше не зміниться.
   */
  const [scope, setScope] = useState<Scope | null>(null);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focus, setFocus] = useState<{ lat: number; lng: number; id?: string; nonce: number } | null>(null);
  const [orderFor, setOrderFor] = useState<{ id: string; name: string; state: ClientStateKey } | null>(null);
  const [commentsFor, setCommentsFor] = useState<{ id: string; name: string } | null>(null);
  const [pinFor, setPinFor] = useState<DriverClient | null>(null);

  // Тягнемо завжди повний набір: 379 точок — одна відповідь, а перемикання
  // «маршрут / мої / всі» після цього миттєве, без походу в мережу.
  useEffect(() => {
    let alive = true;
    fetch("/api/driver/my-map?scope=all")
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error ?? `Помилка ${r.status}`);
        return j as Resp;
      })
      .then((j) => alive && setData(j))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Не вдалося завантажити"));
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Маршрут окремим запитом і з власним життям: клієнти тягнуться раз, а
   * лист міняється щоразу, коли водій обирає інший у шторці.
   */
  useEffect(() => {
    let alive = true;
    // Старий лист лишається на карті, поки їде новий: гасити карту в нуль
    // на секунду мобільного інтернету — це моргання без користі.
    fetch(
      routeKey
        ? `/api/tablet/day?route=${encodeURIComponent(routeKey)}`
        : dayKey
          ? `/api/tablet/day?day=${encodeURIComponent(dayKey)}`
          : "/api/tablet/day"
    )
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error ?? `Помилка ${r.status}`);
        return j as DayResp;
      })
      .then((j) => alive && setDay(j))
      .catch((e) => {
        if (!alive) return;
        // Не вийшло — прибираємо попередній лист: показувати чужі точки
        // під назвою нового маршруту гірше, ніж не показувати нічого.
        setDay(null);
        setError(e instanceof Error ? e.message : "Не вдалося завантажити маршрут");
      });
    return () => {
      alive = false;
    };
  }, [routeKey, dayKey]);

  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setMe({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }, []);

  const toggle = (k: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  /** Точки відкритого листа — лише ті, що мають координати. */
  const planStops = useMemo<PlanStop[]>(
    () =>
      (day?.route.stops ?? [])
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({
          key: s.key,
          seq: s.sequence,
          name: s.name,
          address: s.address,
          lat: s.lat as number,
          lng: s.lng as number,
          amount: s.amount,
          debt: s.debtAmount,
          status: planStatus(s),
          errand: s.kind !== "DELIVERY",
          mapUrl: pointUrl({ lat: s.lat as number, lng: s.lng as number }),
        })),
    [day?.route.stops]
  );

  const plan = useMemo<DayPlan>(
    () =>
      planStops.length > 0
        ? { number: day?.route.number ?? null, geometry: day?.route.geometry ?? null, stops: planStops }
        : null,
    [planStops, day?.route.number, day?.route.geometry]
  );

  /** Клієнти відкритого листа — по них працює перший сегмент фільтра. */
  const routeClientIds = useMemo(
    () => new Set((day?.route.stops ?? []).map((s) => s.counterpartyId).filter(Boolean) as string[]),
    [day?.route.stops]
  );

  /**
   * Скільки точок у сегменті «Маршрут».
   *
   * Рахуємо по самому листу, а не по клієнтах карти: бонусна поїздка
   * клієнта не має взагалі, і без неї число під кнопкою не збігалося б із
   * тим, що водій бачить пінами.
   */
  const routeCount = planStops.length;

  /** Точки, що вилетіли з робочої області, — майже завжди кривий геокод. */
  const strayCount = routeCount - planCore(planStops).length;

  const effScope: Scope = scope ?? (routeCount > 0 ? "route" : "all");

  const visible = (data?.clients ?? [])
    .filter((c) => !hidden.has(c.state))
    .filter((c) =>
      effScope === "route"
        ? routeClientIds.size > 0
          ? routeClientIds.has(c.id)
          : c.today
        : effScope === "mine"
          ? c.mine
          : true
    );

  const pickRoute = useCallback(
    (key: string | null) => {
      // Через адресу, а не стан: відкритий лист має переживати оновлення
      // сторінки й ділитися посиланням з екраном відміток.
      router.replace(key ? `/driver/map?route=${encodeURIComponent(key)}` : "/driver/map");
    },
    [router]
  );

  /** Пін уточнили — правимо точку на місці, без перезавантаження всієї карти. */
  const applyPin = useCallback((id: string, lat: number, lng: number) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            clients: prev.clients.map((c) =>
              c.id === id ? { ...c, lat, lng, approximate: false } : c
            ),
            approximateCount: Math.max(0, prev.approximateCount - 1),
          }
        : prev
    );
  }, []);

  const routeDone = planStops.filter((s) => s.status !== "PENDING").length;
  const routeDay = day?.route.day ?? day?.day ?? "";
  const chipTitle = day
    ? day.route.number
      ? `Маршрут ${day.route.number}`
      : "Маршруту немає"
    : "Завантаження маршруту…";
  const chipSubtitle = day
    ? routeCount > 0
      ? `${formatRouteDay(routeDay, kyivToday())} · ${routeDone} з ${routeCount} точок`
      : "Оберіть маршрутний лист"
    : null;

  return (
    // Фіксований шар на всю висоту мінус нижнє меню водія
    <div
      className="fixed inset-x-0"
      style={{
        top: 0,
        bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))",
        background: "#F3F4F6",
      }}
    >
      <div className="absolute inset-0">
        <SalesClientsMap
          clients={visible}
          route={null}
          plan={plan}
          me={me}
          focus={focus}
          // Картки клієнта в розділі водія немає (там лише маршрути), тож
          // посилання не даємо — натомість коментарі й уточнення піна.
          extras={{ comments: true, pin: true }}
          onAction={(a) => {
            const c = data?.clients.find((x) => x.id === a.id);
            if (!c) return;
            if (a.kind === "orderCard") setOrderFor({ id: c.id, name: c.name, state: c.state });
            else if (a.kind === "comments") setCommentsFor({ id: c.id, name: c.name });
            else if (a.kind === "pin") setPinFor(c);
          }}
        />
      </div>

      {/* Шапка поверх карти */}
      <div
        className="absolute inset-x-0 top-0 z-[500] px-3"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 10px)",
          paddingBottom: "10px",
          background: "linear-gradient(#F3F4F6EE, #F3F4F600)",
        }}
      >
        <div className="flex items-center gap-2">
          {/* Плашка маршруту стоїть там, де раніше був лічильник клієнтів:
              водій відкриває карту заради маршруту, а скільки на ній точок —
              видно в сегментах нижче. */}
          <RouteChip title={chipTitle} subtitle={chipSubtitle} onClick={() => setPickerOpen(true)} />

          <button
            type="button"
            onClick={locate}
            aria-label="Де я"
            className="flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-200"
            style={{
              minWidth: "40px",
              minHeight: "40px",
              background: "#fff",
              boxShadow: "0 1px 6px rgba(0,0,0,0.15)",
              border: "none",
            }}
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke={locating ? "#9CA3AF" : "#2563EB"}
              strokeWidth={1.9}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v3m0 14v3M2 12h3m14 0h3" />
              <circle cx="12" cy="12" r="6" />
            </svg>
          </button>
        </div>

        {/* Обсяг карти. Окремим рядом, а не в шапці: три варіанти поруч із
            плашкою маршруту не влазять у 800px портрета, і «Всі» опинялося б
            за краєм. Сегменти — 44px заввишки, у них цілять пальцем у машині. */}
        {data && (
          <div
            className="mt-2 flex gap-1 rounded-full p-1"
            style={{ background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.12)" }}
          >
            {(
              [
                { key: "route", label: "Маршрут", n: routeCount || data.todayCount },
                { key: "mine", label: "Мої", n: data.mineCount },
                { key: "all", label: "Всі", n: data.clients.length },
              ] as Array<{ key: Scope; label: string; n: number }>
            ).map((s) => {
              const on = effScope === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setScope(s.key)}
                  aria-pressed={on}
                  className="flex-1 cursor-pointer rounded-full transition-colors duration-200"
                  style={{
                    minHeight: "40px",
                    border: "none",
                    background: on ? "#0A0A0A" : "transparent",
                    color: on ? "#fff" : "#374151",
                    fontSize: "13px",
                    fontWeight: on ? 700 : 500,
                  }}
                >
                  {s.label}{" "}
                  <span style={{ color: on ? "rgba(255,255,255,0.65)" : "#9CA3AF", fontWeight: 400 }}>
                    {s.n}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div
          className="absolute inset-x-3 z-[500] rounded-xl p-3"
          style={{ top: "70px", background: "#FEF2F2", border: "1px solid #FECACA" }}
        >
          <p style={{ fontSize: "13px", color: "#B91C1C" }}>{error}</p>
        </div>
      )}

      {/* Нижня панель: точки відкритого листа й легенда-фільтр */}
      {data && (
        <div className="absolute inset-x-0 bottom-0 z-[500] px-3 pb-3" style={{ pointerEvents: "none" }}>
          <div
            className="rounded-2xl"
            style={{
              background: "#fff",
              boxShadow: "0 -1px 12px rgba(0,0,0,0.12)",
              pointerEvents: "auto",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setSheetOpen((v) => !v)}
              className="flex w-full cursor-pointer items-center gap-2 px-4"
              style={{ background: "none", border: "none", minHeight: "48px" }}
            >
              <span style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>
                {routeCount > 0 ? `Точки маршруту · ${routeDone} з ${routeCount}` : "Фільтр за станом"}
              </span>
              {/* Про вилетілі точки кажемо, лише коли відкрито маршрут: у
                  режимі перегляду бази число «приблизних» цікавить менше,
                  а тут воно пояснює, чому пін стоїть за 400 км. */}
              {routeCount > 0 ? (
                strayCount > 0 && (
                  <span style={{ fontSize: "12px", color: "#D97706" }}>
                    {strayCount} далеко від решти
                  </span>
                )
              ) : (
                data.approximateCount > 0 && (
                  <span style={{ fontSize: "12px", color: "#D97706" }}>
                    {data.approximateCount} приблизних
                  </span>
                )
              )}
              <svg
                className="ml-auto h-4 w-4"
                style={{ transform: sheetOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="#9CA3AF"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
              </svg>
            </button>

            {sheetOpen && (
              <div className="px-3 pb-3" style={{ maxHeight: "52vh", overflowY: "auto" }}>
                {planStops.length > 0 && (
                  <>
                    <div style={{ borderTop: "1px solid #F1F1EF" }}>
                      {planStops.map((s) => (
                        <button
                          key={s.key}
                          type="button"
                          onClick={() =>
                            setFocus({ lat: s.lat, lng: s.lng, id: s.key, nonce: Date.now() })
                          }
                          className="flex w-full cursor-pointer items-center gap-2.5 text-left"
                          style={{
                            padding: "9px 4px",
                            border: "none",
                            borderBottom: "1px solid #F1F1EF",
                            background: "none",
                          }}
                        >
                          <span
                            aria-hidden
                            className="flex shrink-0 items-center justify-center"
                            style={{
                              width: "26px",
                              height: "26px",
                              borderRadius: "8px",
                              fontSize: "12px",
                              fontWeight: 800,
                              background:
                                s.status === "DONE" ? "#16A34A" : s.status === "MISSED" ? "#DC2626" : "#0A0A0A",
                              color: s.status === "PENDING" ? "#FFD600" : "#fff",
                            }}
                          >
                            {s.errand ? "+" : s.seq}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className="block truncate"
                              style={{ fontSize: "13.5px", fontWeight: 600, color: "#0A0A0A" }}
                            >
                              {s.name}
                            </span>
                            {!!s.address && (
                              <span className="block truncate" style={{ fontSize: "11.5px", color: "#9CA3AF" }}>
                                {s.address}
                              </span>
                            )}
                          </span>
                          {s.amount > 0 && (
                            <span
                              className="shrink-0"
                              style={{ fontSize: "12.5px", fontWeight: 600, color: "#374151" }}
                            >
                              {money.format(s.amount)} ₴
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    <Link
                      href={
                        day?.route.id
                          ? `/driver/tablet?route=${encodeURIComponent(day.route.id)}`
                          : "/driver/tablet"
                      }
                      className="mt-2.5 block rounded-xl text-center"
                      style={{
                        padding: "11px",
                        background: "#0A0A0A",
                        color: "#fff",
                        fontSize: "13.5px",
                        fontWeight: 700,
                        textDecoration: "none",
                      }}
                    >
                      Відмітки і каса цього дня
                    </Link>
                  </>
                )}

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {LEGEND.map((k) => {
                    const off = hidden.has(k);
                    const n = data.counts[k] ?? 0;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => toggle(k)}
                        aria-pressed={!off}
                        className="flex cursor-pointer items-center gap-1.5 rounded-full px-3 transition-colors duration-200"
                        style={{
                          minHeight: "40px",
                          border: "1px solid #E5E7EB",
                          background: off ? "#F3F4F6" : "#fff",
                          opacity: off ? 0.55 : 1,
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: "9px",
                            height: "9px",
                            borderRadius: "50%",
                            background: CLIENT_STATE[k].color,
                          }}
                        />
                        <span style={{ fontSize: "12px", color: "#0A0A0A" }}>{CLIENT_STATE[k].label}</span>
                        <span style={{ fontSize: "12px", color: "#9CA3AF" }}>{n}</span>
                      </button>
                    );
                  })}
                </div>
                <p style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "8px", lineHeight: 1.4 }}>
                  Квадрати з номерами — точки відкритого листа, кола — клієнти. «Мої» — куди ви вже
                  возили, «Всі» — уся база компанії. Тапніть точку: борг, що клієнт брав, коментарі.
                  Якщо стоїте біля магазину — уточніть точку, вона лишиться всім.
                  {strayCount > 0 &&
                    ` ${strayCount} точок маршруту стоять далеко від решти — там координати лише за назвою міста. Масштаб карти на них не зважає.`}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {pickerOpen && (
        <RouteSheet
          // Коли прийшли з історії за датою, ключ листа знає лише відповідь
          // сервера — беремо його звідти, щоб у списку підсвітився відкритий.
          current={routeKey ?? (dayKey ? (day?.route.id ?? null) : null)}
          onPick={pickRoute}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {orderFor && (
        <ClientOrderModal key={orderFor.id} client={orderFor} onClose={() => setOrderFor(null)} />
      )}
      {commentsFor && (
        <ClientCommentsModal
          key={commentsFor.id}
          client={commentsFor}
          onClose={() => setCommentsFor(null)}
        />
      )}
      {pinFor && (
        <DriverPinModal
          key={pinFor.id}
          client={{
            id: pinFor.id,
            name: pinFor.name,
            lat: pinFor.lat,
            lng: pinFor.lng,
            approximate: pinFor.approximate,
          }}
          onClose={() => setPinFor(null)}
          onSaved={(lat, lng) => applyPin(pinFor.id, lat, lng)}
        />
      )}
    </div>
  );
}
