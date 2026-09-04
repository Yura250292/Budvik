"use client";

/**
 * Вибір маршрутного листа в кабінеті водія.
 *
 * До цього кабінет знав рівно один маршрут — сьогоднішній, — і все, що
 * було вчора або передане на завтра, водій міг лише переказати з голови.
 * Тут він відкриває будь-який свій лист: і карту з точками, і відмітки.
 *
 * Список тягнеться один раз при відкритті шторки, а не разом зі сторінкою:
 * на маршруті кожен зайвий запит — це секунди на мобільному інтернеті, а
 * шторку відкривають рідко.
 *
 * У списку є й ЧУЖІ листи (вимога власника): водій-підмінник і той, хто
 * їде маршрут уперше, мусять бачити, що везуть колеги. Свої стоять вище й
 * позначені — відмічати точки можна лише в них, і сплутати два види рядків
 * за кермом не можна.
 */

import { useEffect, useMemo, useState } from "react";

export type DriverRouteItem = {
  key: string;
  source: "DELIVERY_ROUTE" | "ROUTE_SHEET";
  number: string;
  day: string;
  status: string;
  vehicle: string | null;
  stops: number;
  done: number;
  amount: number;
  plannedKm: number | null;
  driverId: string | null;
  driverName: string | null;
  /** Мій лист: лише в такому працюють відмітки й каса. */
  mine: boolean;
};

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/** «3 вересня, ср» — без року: усі листи в кабінеті свіжі. */
export function formatRouteDay(day: string, today: string): string {
  if (day === today) return "Сьогодні";
  const yesterday = shift(today, -1);
  const tomorrow = shift(today, 1);
  if (day === yesterday) return "Учора";
  if (day === tomorrow) return "Завтра";

  // Порожня або крива дата не має валити екран: Intl кидає RangeError на
  // Invalid Date, і замість кабінету водій побачив би білий екран.
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;

  return new Intl.DateTimeFormat("uk-UA", {
    day: "numeric",
    month: "long",
    weekday: "short",
  }).format(parsed);
}

function shift(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Шторка зі списком листів.
 *
 * `current` — ключ відкритого зараз маршруту; null означає «сьогоднішній,
 * який дав сервер». Порожній рядок у onPick повертає кабінет саме до
 * нього: водієві потрібен спосіб вийти з минулого дня одним тапом, не
 * шукаючи сьогоднішню дату в списку.
 */
export function RouteSheet({
  current,
  onPick,
  onClose,
}: {
  current: string | null;
  onPick: (key: string | null) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<DriverRouteItem[] | null>(null);
  const [today, setToday] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** «Всі» за замовчуванням: заради чужих листів шторку й перероблювали. */
  const [only, setOnly] = useState<"all" | "mine">("all");

  useEffect(() => {
    let alive = true;
    fetch("/api/driver/routes")
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error ?? `Помилка ${r.status}`);
        return j as { today: string; items: DriverRouteItem[] };
      })
      .then((j) => {
        if (!alive) return;
        setItems(j.items);
        setToday(j.today);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Не вдалося завантажити"));
    return () => {
      alive = false;
    };
  }, []);

  // Фільтр на клієнті: список уже приїхав цілком, і похід у мережу на
  // перемикання двох кнопок за кермом коштував би секунд.
  const shown = useMemo(
    () => (only === "mine" ? (items ?? []).filter((i) => i.mine) : (items ?? [])),
    [items, only]
  );
  const hasForeign = (items ?? []).some((i) => !i.mine);

  return (
    <div
      className="fixed inset-0 z-[1000] flex flex-col justify-end"
      style={{ background: "rgba(10,10,10,0.45)" }}
      onClick={onClose}
    >
      <div
        className="flex flex-col rounded-t-2xl bg-white"
        style={{ maxHeight: "80vh", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid #F1F1EF" }}>
          <p style={{ fontSize: "15px", fontWeight: 700, color: "#0A0A0A" }}>Маршрутні листи</p>
          {hasForeign && (
            <div className="flex gap-1 rounded-full p-0.5" style={{ background: "#F3F4F6" }}>
              {(["all", "mine"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setOnly(k)}
                  aria-pressed={only === k}
                  className="cursor-pointer rounded-full transition-colors duration-200"
                  style={{
                    minHeight: "30px",
                    padding: "0 12px",
                    border: "none",
                    background: only === k ? "#0A0A0A" : "transparent",
                    color: only === k ? "#fff" : "#6B7280",
                    fontSize: "12px",
                    fontWeight: 700,
                  }}
                >
                  {k === "all" ? "Всі" : "Мої"}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            className="ml-auto cursor-pointer rounded-lg"
            style={{
              minWidth: "44px",
              minHeight: "36px",
              border: "none",
              background: "#F3F4F6",
              color: "#374151",
              fontSize: "15px",
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && (
            <p className="px-4 py-4" style={{ fontSize: "13px", color: "#B91C1C" }}>
              {error}
            </p>
          )}
          {!items && !error && (
            <p className="px-4 py-4" style={{ fontSize: "13px", color: "#9CA3AF" }}>
              Завантаження…
            </p>
          )}
          {items && shown.length === 0 && (
            <p className="px-4 py-4" style={{ fontSize: "13px", color: "#6B7280", lineHeight: 1.5 }}>
              {only === "mine" && items.length > 0
                ? "Ваших листів у цьому періоді немає — але є листи колег, перемкніть на «Всі»."
                : "Переданих маршрутів поки немає. Лист складає логіст — він зʼявиться тут сам, щойно його передадуть вам."}
            </p>
          )}

          {shown.map((it) => {
            const on = current === it.key;
            return (
              <button
                key={it.key}
                type="button"
                onClick={() => {
                  onPick(it.key);
                  onClose();
                }}
                className="w-full cursor-pointer text-left"
                style={{
                  display: "block",
                  padding: "12px 16px",
                  border: "none",
                  borderBottom: "1px solid #F1F1EF",
                  // Свій лист має жовту смугу зліва, чужий — приглушений фон.
                  // Різниця мусить читатися боковим зором: у чужому не можна
                  // відмічати, і зрозуміти це треба до, а не після тапу.
                  borderLeft: it.mine ? "3px solid #FFD600" : "3px solid transparent",
                  background: on ? "#FFFBEB" : it.mine ? "#fff" : "#FAFAF9",
                }}
              >
                <span className="flex items-baseline gap-2">
                  <span style={{ fontSize: "15px", fontWeight: 700, color: "#0A0A0A" }}>
                    {formatRouteDay(it.day, today)}
                  </span>
                  <span style={{ fontSize: "13px", color: "#6B7280" }}>{it.number}</span>
                  {it.source === "ROUTE_SHEET" && (
                    <span style={{ fontSize: "11px", color: "#9CA3AF" }}>лист 1С</span>
                  )}
                  {on && (
                    <span style={{ marginLeft: "auto", fontSize: "12px", fontWeight: 700, color: "#D97706" }}>
                      відкрито
                    </span>
                  )}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-3" style={{ fontSize: "12.5px", color: "#6B7280" }}>
                  {it.mine ? (
                    <span style={{ fontWeight: 700, color: "#0A0A0A" }}>мій</span>
                  ) : (
                    <span style={{ fontWeight: 600, color: "#374151" }}>
                      {it.driverName ?? "без водія"}
                    </span>
                  )}
                  <span>
                    {it.done} з {it.stops} точок
                  </span>
                  {it.amount > 0 && <span>{money.format(it.amount)} ₴</span>}
                  {it.plannedKm != null && it.plannedKm > 0 && (
                    <span>{String(Math.round(it.plannedKm)).replace(".", ",")} км</span>
                  )}
                  {!!it.vehicle && <span className="truncate">{it.vehicle}</span>}
                </span>
              </button>
            );
          })}
        </div>

        {current && (
          <button
            type="button"
            onClick={() => {
              onPick(null);
              onClose();
            }}
            className="w-full cursor-pointer"
            style={{
              minHeight: "48px",
              border: "none",
              borderTop: "1px solid #F1F1EF",
              background: "#fff",
              color: "#2563EB",
              fontSize: "14px",
              fontWeight: 700,
            }}
          >
            Повернутись до сьогоднішнього
          </button>
        )}
      </div>
    </div>
  );
}

/** Кнопка-плашка «який маршрут відкрито». Тап відкриває шторку вибору. */
export function RouteChip({
  title,
  subtitle,
  onClick,
  dark = false,
}: {
  title: string;
  subtitle?: string | null;
  onClick: () => void;
  dark?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-full px-3 text-left transition-colors duration-200"
      style={{
        minHeight: "40px",
        border: "none",
        background: dark ? "rgba(255,255,255,0.12)" : "#fff",
        boxShadow: dark ? "none" : "0 1px 6px rgba(0,0,0,0.12)",
      }}
    >
      <span className="min-w-0 flex-1">
        <span
          className="block truncate"
          style={{ fontSize: "13px", fontWeight: 700, color: dark ? "#fff" : "#0A0A0A", lineHeight: 1.25 }}
        >
          {title}
        </span>
        {!!subtitle && (
          <span
            className="block truncate"
            style={{ fontSize: "11px", color: dark ? "#9CA3AF" : "#6B7280", lineHeight: 1.25 }}
          >
            {subtitle}
          </span>
        )}
      </span>
      <svg
        className="h-4 w-4 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke={dark ? "#9CA3AF" : "#9CA3AF"}
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
      </svg>
    </button>
  );
}
