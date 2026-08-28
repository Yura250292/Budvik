"use client";

/**
 * Мій день: список точок маршруту, відмітки візитів і каса.
 *
 * Головний екран водія. Карти тут навмисно немає: возити маршрут по
 * власній карті означало тримати планшет у вебі заради треку — а трек
 * тепер пише нативний застосунок у фоні. Тому дорогу водій відкриває у
 * звичному Google Maps, а сюди повертається, щоб відмітити точку.
 *
 * Кнопки великі: у них цілять пальцем, іноді на ходу.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatPrice } from "@/lib/utils";
import {
  flushPendingVisits,
  listPendingVisits,
  queueVisit,
} from "@/lib/track/pending-visits";
import { useTrackRecorder } from "@/hooks/useTrackRecorder";
import { useBuildVersion } from "@/hooks/useBuildVersion";
import { useIsNativeApp } from "@/lib/useIsNativeApp";
import { googleMapsLinks, pointUrl } from "@/lib/maps/google-links";
import type { DayStop } from "@/lib/track/day-stop-type";

type Handover = {
  id: string;
  amount: number;
  handedAt: string;
  confirmedAt: string | null;
  confirmedAmount: number | null;
  comment: string | null;
};

type DayResp = {
  day: string;
  role: string;
  route: {
    source: "ROUTE_SHEET" | "DELIVERY_ROUTE" | "NONE";
    number: string | null;
    vehicle: string | null;
    plannedKm: number | null;
    stops: DayStop[];
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
  };
  cash: {
    collected: number;
    handed: number;
    onHands: number;
    handovers: Handover[];
  };
};

/** «1 точка / 3 точки / 10 точок» — на кнопці неправильна форма ріже око. */
function pointsLabel(n: number): string {
  const last = n % 10;
  const teen = n % 100 >= 11 && n % 100 <= 14;
  if (!teen && last === 1) return `${n} точка`;
  if (!teen && last >= 2 && last <= 4) return `${n} точки`;
  return `${n} точок`;
}

/** Що показує індикатор треку в шапці. */
const TRACK_BADGE: Record<string, { dot: string; label: string }> = {
  live: { dot: "#16A34A", label: "Трек іде" },
  buffering: { dot: "#D97706", label: "Немає звʼязку" },
  denied: { dot: "#DC2626", label: "Немає доступу до GPS" },
  unsupported: { dot: "#DC2626", label: "GPS недоступний" },
  idle: { dot: "#9CA3AF", label: "Трек вимкнено" },
};

export default function DriverDayPage() {
  const [data, setData] = useState<DayResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openStop, setOpenStop] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [queued, setQueued] = useState<string[]>([]);

  const isApp = useIsNativeApp();
  /**
   * У застосунку трек пише нативна служба: вона переживає і згорнуту
   * вкладку, і вихід у Google Maps. Веб-рекордер там був би другим
   * джерелом тих самих координат — зайвий шум у пробігу.
   */
  const track = useTrackRecorder({ enabled: !isApp });
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

  /**
   * Чергу віддаємо ПЕРЕД завантаженням дня.
   *
   * Інакше сервер поверне день без щойно зроблених відміток, і вони «зникнуть»
   * з екрана — людина вирішить, що натиснула не туди, і тисне ще раз.
   */
  const loadWithQueue = useCallback(async () => {
    await flushPendingVisits().catch(() => {});
    setQueued(listPendingVisits().map((v) => v.stopKey));
    await load();
  }, [load]);

  useEffect(() => {
    void loadWithQueue();
  }, [loadWithQueue]);

  /**
   * Повернення мережі — найкращий момент дожати чергу: браузер каже про це
   * сам, і чекати наступного оновлення сторінки не треба.
   */
  useEffect(() => {
    const onOnline = () => void loadWithQueue();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [loadWithQueue]);

  const mark = useCallback(
    async (
      stop: DayStop,
      status: "DONE" | "MISSED",
      money_: "FULL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE",
      extra?: { collectedAmount?: number; comment?: string }
    ) => {
      // Бонусна поїздка не має клієнта, а візит без клієнта неможливий
      // (@@unique [userId, day, counterpartyId]) — для неї станом служить
      // сам DeliveryStop.
      const isErrandStop = stop.kind !== "DELIVERY";
      /**
       * Точка доставки без клієнта — це не помилка водія, а недороблений
       * маршрут: візит без контрагента неможливий (@@unique за ним).
       * Раніше кнопка тут просто нічого не робила, і людина тиснула її знову й
       * знову, вважаючи, що зламався планшет.
       */
      if (!isErrandStop && !stop.counterpartyId) {
        setError(
          `«${stop.name}» не прив'язана до клієнта — відмітити не вийде. Скажіть логісту, він допише її в маршрут.`
        );
        return;
      }

      const url = isErrandStop
        ? `/api/erp/delivery-routes/stop/${stop.key.slice(3)}/mark`
        : "/api/visits";
      const body = isErrandStop
        ? { status: status === "DONE" ? "DELIVERED" : "FAILED", comment: extra?.comment }
        : {
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
          };

      /**
       * Спершу в чергу, потім спроба надіслати.
       *
       * Такий порядок означає, що відмітка не губиться навіть тоді, коли
       * сторінку закриють одразу після натискання або зв'язок обірветься
       * посеред запиту. Те саме правило, що в застосунку.
       */
      queueVisit({
        stopKey: stop.key,
        kind: isErrandStop ? "errand" : "visit",
        url,
        body,
        label: stop.name,
        createdAt: Date.now(),
      });
      setQueued(listPendingVisits().map((v) => v.stopKey));
      setOpenStop(null);
      setError(null);

      setSaving(stop.key);
      try {
        await flushPendingVisits();
        setQueued(listPendingVisits().map((v) => v.stopKey));
        await load();
      } catch {
        // Не помилка: відмітка вже в черзі й піде, щойно з'явиться мережа.
      } finally {
        setSaving(null);
      }
    },
    [load, track.position]
  );

  const badge = TRACK_BADGE[track.status] ?? TRACK_BADGE.idle;
  // useMemo, а не ?? []: новий порожній масив на кожен рендер перезапускав
  // би розрахунок посилань нижче.
  const stops = useMemo(() => data?.route.stops ?? [], [data?.route.stops]);

  /**
   * Дорога в Google Maps: від того місця, де водій зараз, через ще не
   * відмічені точки. Відмічені навмисно пропускаємо — везти водія туди,
   * де він уже був, немає сенсу.
   */
  const mapLinks = useMemo(() => {
    const pending = stops
      .filter((s) => !s.visit && !queued.includes(s.key) && s.lat != null && s.lng != null)
      .map((s) => ({ lat: s.lat as number, lng: s.lng as number }));
    if (pending.length === 0) return [];

    const from = track.position ? [{ lat: track.position.lat, lng: track.position.lng }] : [];
    return googleMapsLinks([...from, ...pending]);
  }, [stops, track.position, queued]);

  return (
    <div style={{ background: "#F3F4F6", minHeight: "100vh" }}>
      {/* Шапка: маршрут, прогрес, стан треку.
          Цифри великі — на них дивляться скоса, тримаючи кермо. */}
      <header
        className="sticky top-0 z-20"
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
                      {formatPrice(data.progress.collected)}
                    </span>
                    {" / "}
                    {formatPrice(data.progress.debtPlanned)}
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
                    background: isApp ? "#16A34A" : badge.dot,
                    display: "inline-block",
                  }}
                />
                {/* У застосунку трек веде служба, а не ця вкладка —
                    показувати її стан було б брехнею. */}
                {isApp ? "Трек іде" : badge.label}
                {!isApp && track.pending > 0 && (
                  <span style={{ color: "#FB923C" }}>+{track.pending}</span>
                )}
              </p>
            </div>
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
          className="cursor-pointer transition-colors duration-200"
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

      {queued.length > 0 && (
        <div className="px-4 py-2.5" style={{ background: "#FEF3C7", borderBottom: "1px solid #FDE68A" }}>
          <p style={{ fontSize: "13.5px", fontWeight: 600, color: "#92400E" }}>
            Чекає на мережу: {queued.length}
          </p>
          <p style={{ fontSize: "12.5px", color: "#92400E", marginTop: "2px" }}>
            Відмітки збережено на планшеті. Надішлемо самі — тикати ще раз не треба.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: "#DC2626" }}>
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
            Логіст ще складає список. Точки зʼявляться, щойно маршрут передадуть
            вам — трек тим часом усе одно записується.
          </p>
        </div>
      ) : (
        <>
          {mapLinks.length > 0 && (
            <section className="px-4 py-3" style={{ background: "#fff" }}>
              <p
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "#6B7280",
                  textTransform: "uppercase",
                  letterSpacing: "0.03em",
                }}
              >
                Дорога в Google Maps
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {mapLinks.map((link, idx) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener"
                    className="cursor-pointer transition-colors duration-200"
                    style={{
                      flex: mapLinks.length === 1 ? "1 1 100%" : "1 1 45%",
                      padding: "13px 14px",
                      borderRadius: "12px",
                      background: idx === 0 ? "#2563EB" : "#EFF6FF",
                      color: idx === 0 ? "#fff" : "#1D4ED8",
                      fontSize: "14px",
                      fontWeight: 700,
                      textAlign: "center",
                      textDecoration: "none",
                    }}
                  >
                    {mapLinks.length === 1
                      ? `Відкрити маршрут · ${pointsLabel(link.points)}`
                      : `Частина ${idx + 1} · ${pointsLabel(link.points)}`}
                  </a>
                ))}
              </div>
              {mapLinks.length > 1 && (
                <p style={{ fontSize: "12px", color: "#6B7280", marginTop: "8px", lineHeight: 1.5 }}>
                  Google веде щонайбільше 10 точок за раз. Доїхали до кінця першої
                  частини — відкривайте наступну, вона починається там само.
                </p>
              )}
            </section>
          )}

          <div style={{ background: "#fff", marginTop: mapLinks.length > 0 ? "8px" : 0 }}>
            {stops.map((s) => (
              <StopRow
                key={s.key}
                stop={s}
                open={openStop === s.key}
                saving={saving === s.key}
                pending={queued.includes(s.key)}
                onToggle={() => setOpenStop(openStop === s.key ? null : s.key)}
                onMark={mark}
              />
            ))}
          </div>

          <CashPanel cash={data.cash} day={data.day} onSaved={load} onError={setError} />
        </>
      )}
    </div>
  );
}

/**
 * Каса за день: скільки зібрав, скільки везе, кнопка здачі.
 *
 * Стоїть у кінці списку навмисно — це останнє, що водій робить за день,
 * прокрутивши всі точки.
 */
function CashPanel({
  cash,
  day,
  onSaved,
  onError,
}: {
  cash: DayResp["cash"];
  day: string;
  onSaved: () => Promise<void> | void;
  onError: (message: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const startHandover = () => {
    // Підставляємо те, що на руках: у більшості днів водій просто
    // підтверджує цифру, не набираючи її пальцем у машині.
    setAmount(String(Math.max(0, Math.round(cash.onHands * 100) / 100)));
    setComment("");
    setOpen(true);
  };

  const submit = async () => {
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      onError("Вкажіть суму, яку здаєте");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/driver/cash-handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: value, day, comment: comment || undefined }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти здачу");
      setOpen(false);
      onError(null);
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Не вдалося зберегти здачу");
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/driver/cash-handover?id=${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося скасувати");
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Не вдалося скасувати здачу");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="px-4 py-4"
      style={{ background: "#fff", marginTop: "8px" }}
    >
      <p
        style={{
          fontSize: "12px",
          fontWeight: 700,
          color: "#6B7280",
          textTransform: "uppercase",
          letterSpacing: "0.03em",
        }}
      >
        Каса за сьогодні
      </p>

      <div className="mt-2 flex items-baseline gap-3">
        <span style={{ fontSize: "13px", color: "#374151" }}>
          Зібрано {formatPrice(cash.collected)}
        </span>
        {cash.handed > 0 && (
          <span style={{ fontSize: "13px", color: "#6B7280" }}>
            здано {formatPrice(cash.handed)}
          </span>
        )}
      </div>

      <p style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A", marginTop: "2px" }}>
        На руках: {formatPrice(cash.onHands)}
      </p>

      {cash.handovers.length > 0 && (
        <ul className="mt-3" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {cash.handovers.map((h) => (
            <li
              key={h.id}
              className="flex items-center gap-2"
              style={{ padding: "8px 0", borderTop: "1px solid #F3F4F6" }}
            >
              <span className="min-w-0 flex-1">
                <span style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>
                  {formatPrice(h.amount)}
                </span>
                <span style={{ fontSize: "12px", color: "#6B7280", marginLeft: "8px" }}>
                  о{" "}
                  {new Date(h.handedAt).toLocaleTimeString("uk-UA", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span
                  className="block"
                  style={{
                    fontSize: "12px",
                    marginTop: "1px",
                    color: h.confirmedAt ? "#16A34A" : "#D97706",
                    fontWeight: 600,
                  }}
                >
                  {h.confirmedAt
                    ? `Прийнято${
                        h.confirmedAmount != null && h.confirmedAmount !== h.amount
                          ? ` ${formatPrice(h.confirmedAmount)}`
                          : ""
                      }`
                    : "Очікує підтвердження офісу"}
                </span>
              </span>
              {/* Скасувати можна лише непідтверджену: після прийому це вже
                  документ про гроші, і прибирати його водієві не можна. */}
              {!h.confirmedAt && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void cancel(h.id)}
                  className="shrink-0 cursor-pointer rounded-lg"
                  style={{
                    minHeight: "40px",
                    padding: "0 12px",
                    border: "1px solid #E5E7EB",
                    background: "#fff",
                    color: "#6B7280",
                    fontSize: "13px",
                    fontWeight: 600,
                  }}
                >
                  Скасувати
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <button
          type="button"
          disabled={cash.onHands <= 0}
          onClick={startHandover}
          className="w-full cursor-pointer transition-colors duration-200 disabled:cursor-default"
          style={{
            marginTop: "12px",
            padding: "15px",
            borderRadius: "12px",
            border: "none",
            background: cash.onHands > 0 ? "#0A0A0A" : "#F3F4F6",
            color: cash.onHands > 0 ? "#fff" : "#9CA3AF",
            fontSize: "15px",
            fontWeight: 700,
          }}
        >
          {cash.onHands > 0
            ? `Здаю касу ${formatPrice(cash.onHands)}`
            : cash.handed > 0
              ? "Усе здано"
              : "Поки нема чого здавати"}
        </button>
      ) : (
        <div className="mt-3">
          <label
            htmlFor="cash-amount"
            style={{ fontSize: "13px", color: "#374151", fontWeight: 600 }}
          >
            Скільки здаєте, ₴
          </label>
          <input
            id="cash-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
            style={{
              width: "100%",
              marginTop: "6px",
              padding: "13px",
              borderRadius: "10px",
              border: "1px solid #E5E7EB",
              fontSize: "18px",
              fontWeight: 700,
              textAlign: "center",
            }}
          />
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Коментар: решта, розмін…"
            style={{
              width: "100%",
              marginTop: "8px",
              padding: "11px",
              borderRadius: "10px",
              border: "1px solid #E5E7EB",
              fontSize: "14px",
            }}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => setOpen(false)}
              className="cursor-pointer"
              style={{
                flex: 1,
                padding: "13px",
                borderRadius: "10px",
                border: "1px solid #E5E7EB",
                background: "#fff",
                color: "#374151",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              Скасувати
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void submit()}
              className="cursor-pointer"
              style={{
                flex: 2,
                padding: "13px",
                borderRadius: "10px",
                border: "none",
                background: "#16A34A",
                color: "#fff",
                fontSize: "15px",
                fontWeight: 700,
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Зберігаю…" : "Підтверджую здачу"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Рядок чек-ліста: згорнутий — статус, розгорнутий — кнопки й гроші. */
function StopRow({
  stop,
  open,
  saving,
  pending,
  onToggle,
  onMark,
}: {
  stop: DayStop;
  open: boolean;
  saving: boolean;
  /** Відмітка збережена на пристрої, але ще не доїхала на сервер. */
  pending: boolean;
  onToggle: () => void;
  onMark: (
    stop: DayStop,
    status: "DONE" | "MISSED",
    money: "FULL" | "PARTIAL" | "NONE" | "NOT_APPLICABLE",
    extra?: { collectedAmount?: number; comment?: string }
  ) => void;
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
        className="flex w-full items-start gap-3 text-left"
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
            {isErrand && (
              <span style={{ marginRight: "5px" }}>{stop.kind === "PICKUP" ? "↩️" : "✳️"}</span>
            )}
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
                {formatPrice(stop.amount)}
              </span>
            )}
            {hasDebt && (
              <span style={{ fontSize: "12px", color: "#DC2626", fontWeight: 600 }}>
                борг {formatPrice(stop.debtAmount)}
              </span>
            )}
            {stop.visit?.collectedAmount != null && stop.visit.collectedAmount > 0 && (
              <span style={{ fontSize: "12px", color: "#16A34A", fontWeight: 600 }}>
                забрано {formatPrice(stop.visit.collectedAmount)}
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
                ? `Приїхав, забрав ${formatPrice(stop.debtAmount)}`
                : isErrand
                  ? "Зробив"
                  : "Приїхав"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                onMark(stop, "MISSED", "NOT_APPLICABLE", { comment: comment || undefined })
              }
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
                aria-label="Часткова сума"
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

          {pending ? (
            <p style={{ fontSize: "12px", color: "#B45309", marginTop: "8px" }}>
              Збережено на пристрої — надішлемо, щойно з’явиться мережа. Тиснути ще раз не треба.
            </p>
          ) : (
            stop.visit?.status && (
              <p style={{ fontSize: "12px", color: "#6B7280", marginTop: "8px" }}>
                Відмічено. Натисніть іншу кнопку, щоб виправити.
              </p>
            )
          )}

          {stop.lat != null && stop.lng != null && (
            <a
              href={pointUrl({ lat: stop.lat, lng: stop.lng })}
              target="_blank"
              rel="noopener"
              className="w-full cursor-pointer transition-colors duration-200"
              style={{
                display: "block",
                marginTop: "8px",
                padding: "12px",
                borderRadius: "10px",
                background: "#2563EB",
                color: "#fff",
                textAlign: "center",
                fontSize: "14px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Відкрити в Google Maps
            </a>
          )}
        </div>
      )}
    </div>
  );
}
