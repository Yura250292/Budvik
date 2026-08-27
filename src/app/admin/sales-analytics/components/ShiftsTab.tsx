"use client";

/**
 * Зміни торгових: одометр проти GPS.
 *
 * Головне питання екрана — чи збігається пробіг, за який платять, з
 * тим, що бачив трек. Тому обидва числа стоять поруч, а їхнє
 * співвідношення винесене окремою колонкою: одометр завжди більший
 * (трек іде по прямій між точками), і тривожить не сам розрив, а його
 * розмір.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Period } from "@/components/ui/PeriodPicker";
import { TableScroll } from "@/components/ui/TableScroll";

const ShiftTrackMap = dynamic(() => import("@/components/map/ShiftTrackMap"), {
  ssr: false,
  loading: () => <div style={{ height: 420, background: "#F3F4F6", borderRadius: 12 }} />,
});

type ShiftRow = {
  id: string;
  userId: string;
  name: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  startOdometer: number;
  endOdometer: number | null;
  startOdometerSource: string;
  endOdometerSource: string | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  gpsDistanceKm: number | null;
  odometerToGpsRatio: number | null;
  personalKm: number | null;
  odometerSuspicious: boolean;
  closedAutomatically: boolean;
  startPhotoUrl: string | null;
  endPhotoUrl: string | null;
  pointsCount: number;
  /** Перевитрата проти призначеного маршруту; null — маршруту на день немає */
  overrun: {
    plannedKm: number;
    actualKm: number;
    extraKm: number;
    overrunPct: number;
    exceeded: boolean;
  } | null;
};

type OrderDot = {
  counterpartyId: string;
  name: string;
  lat: number;
  lng: number;
  number: string;
  amount: number;
  time: string;
  draft: boolean;
};

type Detail = {
  /** Клієнти, від яких цього дня є замовлення. */
  orders: { dots: OrderDot[]; unmapped: number; total: number };
  shift: ShiftRow & { notes: string | null };
  user: { id: string; name: string };
  reads: Array<{
    id: string;
    phase: string;
    photoUrl: string | null;
    aiValue: number | null;
    aiConfidence: number | null;
    aiDigitsRead: string | null;
    rejectedReason: string | null;
    createdAt: string;
  }>;
  attempts: { start: number; end: number };
  track: {
    shift: { points: Array<{ lat: number; lng: number }>; path: Array<[number, number]>; pointsCount: number };
    afterShift: { points: Array<{ lat: number; lng: number }>; path: Array<[number, number]>; pointsCount: number };
  };
  plan: {
    day: string;
    route: {
      templateId: string;
      name: string;
      totalDistanceKm: number | null;
      geometry: { type?: string; coordinates?: [number, number][] } | null;
      stops: Array<{ settlement: string; displayName: string | null; lat: number; lng: number; seq: number }>;
      source: "DATE" | "WEEKDAY";
    } | null;
    overrun: {
      plannedKm: number;
      actualKm: number;
      extraKm: number;
      overrunPct: number;
      exceeded: boolean;
    } | null;
    thresholdPct: number;
    base: { lat: number; lng: number; address: string | null } | null;
    legs: { toFirstKm: number; fromLastKm: number; totalKm: number } | null;
    routeKm: number | null;
    coverage: { visited: number; total: number; missed: string[] } | null;
    deviation: {
      onRouteRatio: number | null;
      offRouteKm: number;
      excursions: Array<{
        minutes: number;
        km: number;
        maxDistanceM: number;
        lat: number;
        lng: number;
        fromTime: string;
        toTime: string;
      }>;
    } | null;
    corridorM: number;
    planFromGeometry: boolean;
  };
};

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Триває",
  CLOSED: "Закрита",
  ABANDONED: "Не закрита",
};

const SOURCE_LABEL: Record<string, string> = {
  AI: "AI",
  MANUAL: "вручну",
  CORRECTED: "AI + правка",
};

function time(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function ShiftsTab({ period }: { period: Period }) {
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [summary, setSummary] = useState<{
    count: number;
    totalKm: number;
    suspicious: number;
    autoClosed: number;
    overrunning: number;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  /** Клієнт, на якому тримають курсор у списку — його кільце на карті більшає. */
  const [hoverOrder, setHoverOrder] = useState<string | null>(null);
  /**
   * Фото одометра — згорнуті.
   *
   * Досі картка починалася з двох великих квадратів, і в половини змін
   * обидва були порожні («немає фото»): екран відкривався сірою
   * пусткою, а карта, заради якої сюди й заходять, лишалась аж під нею.
   */
  const [showPhotos, setShowPhotos] = useState(false);
  const detailRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlySuspicious, setOnlySuspicious] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ from: period.from, to: period.to });
      if (onlySuspicious) q.set("suspicious", "1");
      const res = await fetch(`/api/admin/shifts?${q}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      setRows(json.shifts ?? []);
      setSummary(json.summary ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити");
    }
  }, [period.from, period.to, onlySuspicious]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    (async () => {
      const res = await fetch(`/api/admin/shifts/${selected}`);
      const json = await res.json().catch(() => null);
      if (!alive || !res.ok) return;
      setDetail(json);
      /**
       * Картка живе під таблицею, а таблиця буває на два екрани. Досі
       * клік по рядку виглядав так, ніби нічого не сталося: деталі
       * відкривались там, куди ніхто не дивиться. Тепер екран сам
       * доводить до них.
       */
      requestAnimationFrame(() =>
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      );
    })();
    return () => {
      alive = false;
    };
  }, [selected]);

  if (error) {
    return (
      <div className="rounded-xl p-4" style={{ border: "1px solid #FECACA", background: "#FEF2F2" }}>
        <p style={{ fontSize: 13, color: "#991B1B" }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summary && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2" style={{ fontSize: 14 }}>
          <span>
            Змін: <b>{summary.count}</b>
          </span>
          <span>
            Пробіг: <b>{summary.totalKm} км</b>
          </span>
          {summary.suspicious > 0 && (
            <span style={{ color: "#DC2626" }}>
              Потребують уваги: <b>{summary.suspicious}</b>
            </span>
          )}
          {summary.autoClosed > 0 && (
            <span style={{ color: "#D97706" }}>
              Закриті автоматично: <b>{summary.autoClosed}</b>
            </span>
          )}
          {summary.overrunning > 0 && (
            <span style={{ color: "#DC2626" }}>
              Понад план: <b>{summary.overrunning}</b>
            </span>
          )}
          <label className="flex items-center gap-2" style={{ marginLeft: "auto", fontSize: 13, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={onlySuspicious}
              onChange={(e) => setOnlySuspicious(e.target.checked)}
            />
            Лише підозрілі
          </label>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl p-6 text-center" style={{ border: "1px solid #E5E7EB", background: "#fff" }}>
          <p style={{ fontSize: 15, fontWeight: 600 }}>За цей період змін немає</p>
          <p style={{ fontSize: 13, color: "#6B7280", marginTop: 6 }}>
            Зміна створюється, коли торговий фотографує одометр у застосунку.
          </p>
        </div>
      ) : (
        <TableScroll stickyHeader className="rounded-xl border border-g200">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                <th style={th}>Торговий</th>
                <th style={th}>Початок</th>
                <th style={th}>Кінець</th>
                <th style={thR}>Одометр</th>
                <th style={thR}>Пробіг</th>
                <th style={thR}>GPS</th>
                <th style={thR}>Одометр/GPS</th>
                <th style={thR}>План</th>
                <th style={th}>Стан</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const mine = selected === s.id;
                return (
                  <tr
                    key={s.id}
                    onClick={() => setSelected(mine ? null : s.id)}
                    title="Клацніть, щоб побачити маршрут і замовлення цього дня"
                    className={mine ? undefined : "hover:bg-g50"}
                    style={{
                      borderTop: "1px solid #F3F4F6",
                      cursor: "pointer",
                      background: mine ? "#F0F9FF" : s.odometerSuspicious ? "#FFFBEB" : undefined,
                    }}
                  >
                    <td style={td}>
                      {/* Смужка ліворуч у вибраного: у таблиці на два екрани
                          підсвітка тла зникає з очей, щойно доїдеш до картки. */}
                      <span
                        aria-hidden
                        style={{
                          display: "inline-block",
                          width: 3,
                          height: 15,
                          borderRadius: 2,
                          marginRight: 8,
                          verticalAlign: "-2px",
                          background: mine ? "#2563EB" : "transparent",
                        }}
                      />
                      {s.name}
                    </td>
                    <td style={td}>{time(s.startedAt)}</td>
                    <td style={td}>{s.endedAt ? time(s.endedAt) : "—"}</td>
                    <td style={tdR}>
                      {s.startOdometer.toLocaleString("uk-UA")}
                      {s.endOdometer != null && ` → ${s.endOdometer.toLocaleString("uk-UA")}`}
                    </td>
                    <td style={{ ...tdR, fontWeight: 600 }}>
                      {s.distanceKm != null ? `${s.distanceKm} км` : "—"}
                    </td>
                    <td style={tdR}>{s.gpsDistanceKm != null ? `${s.gpsDistanceKm} км` : "—"}</td>
                    <td
                      style={{
                        ...tdR,
                        // Менше за 1 означає, що одометр показав менше за трек —
                        // фізично так не буває, отже щось не так із числом.
                        color:
                          s.odometerToGpsRatio == null
                            ? "#9CA3AF"
                            : s.odometerToGpsRatio < 1 || s.odometerToGpsRatio > 2.5
                              ? "#DC2626"
                              : "#16A34A",
                      }}
                    >
                      {s.odometerToGpsRatio != null ? s.odometerToGpsRatio.toFixed(2) : "—"}
                    </td>
                    <td
                      style={{
                        ...tdR,
                        color: s.overrun == null ? "#9CA3AF" : s.overrun.exceeded ? "#DC2626" : "#16A34A",
                        fontWeight: s.overrun?.exceeded ? 700 : 400,
                      }}
                      title={
                        s.overrun
                          ? `План ${s.overrun.plannedKm} км · Факт ${s.overrun.actualKm} км`
                          : "На цей день маршрут не призначений"
                      }
                    >
                      {s.overrun
                        ? `${s.overrun.overrunPct >= 0 ? "+" : ""}${s.overrun.overrunPct}%`
                        : "—"}
                    </td>
                    <td style={td}>
                      {STATUS_LABEL[s.status] ?? s.status}
                      {s.closedAutomatically && (
                        <span style={{ color: "#D97706", fontSize: 12 }}> · авто</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}

      {detail && (
        <div
          ref={detailRef}
          className="rounded-xl p-4 space-y-4"
          style={{ border: "1px solid #E5E7EB", background: "#fff", scrollMarginTop: 12 }}
        >
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span style={{ fontSize: 16, fontWeight: 700 }}>{detail.user.name}</span>
            <span style={{ fontSize: 13, color: "#6B7280" }}>
              {time(detail.shift.startedAt)}
              {detail.shift.endedAt && ` — ${time(detail.shift.endedAt)}`}
              {detail.shift.durationMinutes != null &&
                ` · ${Math.floor(detail.shift.durationMinutes / 60)} год ${detail.shift.durationMinutes % 60} хв`}
            </span>
            <button
              type="button"
              onClick={() => setSelected(null)}
              style={{
                marginLeft: "auto",
                fontSize: 13,
                color: "#6B7280",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px 6px",
              }}
            >
              Закрити ✕
            </button>
          </div>

          {/*
            Головні числа зміни — рядком, до всього іншого.
            Раніше їх доводилось вишукувати: одометр під фотографіями,
            GPS у таблиці вище, замовлень не було ніде.
          */}
          <div className="flex flex-wrap gap-2">
            <Metric
              label="Одометр"
              value={
                detail.shift.distanceKm != null ? `${detail.shift.distanceKm} км` : "—"
              }
              hint={
                detail.shift.endOdometer != null
                  ? `${detail.shift.startOdometer.toLocaleString("uk-UA")} → ${detail.shift.endOdometer.toLocaleString("uk-UA")}`
                  : `з ${detail.shift.startOdometer.toLocaleString("uk-UA")}, кінця немає`
              }
            />
            <Metric
              label="За треком"
              value={
                detail.shift.gpsDistanceKm != null ? `${detail.shift.gpsDistanceKm} км` : "—"
              }
              hint={`${detail.track.shift.pointsCount} точок`}
            />
            <Metric
              label="Одометр / трек"
              value={
                detail.shift.odometerToGpsRatio != null
                  ? detail.shift.odometerToGpsRatio.toFixed(2)
                  : "—"
              }
              hint={
                detail.shift.odometerToGpsRatio == null
                  ? "нема з чим порівняти"
                  : detail.shift.odometerToGpsRatio < 1
                    ? "одометр менший за трек — так не буває"
                    : detail.shift.odometerToGpsRatio > 2.5
                      ? "розрив завеликий"
                      : "у межах норми"
              }
              color={
                detail.shift.odometerToGpsRatio == null
                  ? undefined
                  : detail.shift.odometerToGpsRatio < 1 || detail.shift.odometerToGpsRatio > 2.5
                    ? "#DC2626"
                    : "#16A34A"
              }
            />
            <Metric
              label="Замовлень"
              value={String(detail.orders.total)}
              hint={
                detail.orders.unmapped > 0
                  ? `${detail.orders.unmapped} без координат`
                  : "усі на карті"
              }
              color={detail.orders.total > 0 ? "#7C3AED" : undefined}
            />
          </div>

          {detail.shift.closedAutomatically && (
            <div className="rounded-lg p-3" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
              <p style={{ fontSize: 13, color: "#92400E", lineHeight: 1.5 }}>
                Зміну закрито автоматично: торговий не зробив фінішного фото.
                Пробіг порахований до старту наступної зміни, тому включає вечір
                і дорогу додому — це не чисто робочі кілометри.
              </p>
            </div>
          )}

          {detail.plan.route && <PlanVerdict plan={detail.plan} route={detail.plan.route} />}

          {/*
            Карта й список замовлень поруч: ліворуч куди їздив, праворуч
            заради чого. Нарізно вони відповідають на пів питання кожен.
          */}
          <div className="flex flex-wrap gap-4">
            <div style={{ flex: "1 1 460px", minWidth: 0 }}>
              {detail.track.shift.pointsCount > 0 ||
              detail.track.afterShift.pointsCount > 0 ||
              detail.orders.dots.length > 0 ? (
                <>
                  <ShiftTrackMap
                    shiftPath={detail.track.shift.path}
                    afterShiftPath={detail.track.afterShift.path}
                    planGeometry={detail.plan.route?.geometry ?? null}
                    planStops={detail.plan.route?.stops ?? []}
                    excursions={detail.plan.deviation?.excursions ?? []}
                    orders={detail.orders.dots}
                    focusOrderId={hoverOrder}
                    base={detail.plan.base}
                    height="480px"
                  />
                  <div className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 13, marginTop: 8 }}>
                    {detail.track.shift.pointsCount > 0 && (
                      <span>
                        <span style={{ display: "inline-block", width: 22, height: 3, background: "#2563EB", verticalAlign: "middle", marginRight: 6 }} />
                        Трек зміни ({detail.track.shift.pointsCount} точок)
                      </span>
                    )}
                    {detail.track.afterShift.pointsCount > 0 && (
                      <span>
                        <span style={{ display: "inline-block", width: 22, height: 3, background: "#DC2626", verticalAlign: "middle", marginRight: 6 }} />
                        Після зміни ({detail.track.afterShift.pointsCount} точок)
                      </span>
                    )}
                    {detail.orders.dots.length > 0 && (
                      <span>
                        <span style={{ display: "inline-block", width: 11, height: 11, borderRadius: "50%", background: "#7C3AED", verticalAlign: "middle", marginRight: 6 }} />
                        Замовлення ({detail.orders.dots.length})
                      </span>
                    )}
                    {detail.plan.route && (
                      <span>
                        <span style={{ display: "inline-block", width: 22, height: 5, background: "#16A34A", opacity: 0.45, verticalAlign: "middle", marginRight: 6 }} />
                        Маршрут за планом
                        {!detail.plan.planFromGeometry && " (прямі між пунктами)"}
                      </span>
                    )}
                    {(detail.plan.deviation?.excursions.length ?? 0) > 0 && (
                      <span>
                        <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", border: "2px dashed #DC2626", verticalAlign: "middle", marginRight: 6 }} />
                        Відхилення ({detail.plan.deviation!.excursions.length})
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div
                  className="rounded-lg"
                  style={{
                    height: 200, background: "#F9FAFB", border: "1px dashed #E5E7EB",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    textAlign: "center", padding: 16,
                  }}
                >
                  <p style={{ fontSize: 13, color: "#9CA3AF", lineHeight: 1.6 }}>
                    Ні треку, ні замовлень за цей день.<br />
                    Застосунок не надіслав точок — перевірте планшет у розділі «Аналітика водіїв».
                  </p>
                </div>
              )}
            </div>

            <OrdersList
              orders={detail.orders}
              hoverId={hoverOrder}
              onHover={setHoverOrder}
            />
          </div>

          {/*
            Фото одометра — під згорткою.
            Вони потрібні рівно тоді, коли число викликало сумнів, а це
            рідкість; решту часу вони займали пів екрана.
          */}
          <div>
            <button
              type="button"
              onClick={() => setShowPhotos((v) => !v)}
              style={{
                fontSize: 13, color: "#2563EB", background: "none", border: "none",
                cursor: "pointer", padding: 0,
              }}
            >
              {showPhotos ? "Сховати фото одометра" : "Показати фото одометра"}
            </button>
            {showPhotos && (
              <div className="flex flex-wrap gap-4" style={{ marginTop: 10 }}>
                {(["start", "end"] as const).map((edge) => {
                  const url = edge === "start" ? detail.shift.startPhotoUrl : detail.shift.endPhotoUrl;
                  const value = edge === "start" ? detail.shift.startOdometer : detail.shift.endOdometer;
                  const src = edge === "start" ? detail.shift.startOdometerSource : detail.shift.endOdometerSource;
                  const tries = edge === "start" ? detail.attempts.start : detail.attempts.end;
                  return (
                    <div key={edge} style={{ minWidth: 200 }}>
                      <p style={{ fontSize: 12, color: "#6B7280", marginBottom: 4 }}>
                        {edge === "start" ? "Початок зміни" : "Кінець зміни"}
                      </p>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt="Одометр"
                            style={{ width: 200, height: 130, objectFit: "cover", borderRadius: 8, border: "1px solid #E5E7EB" }}
                          />
                        </a>
                      ) : (
                        <div
                          style={{
                            width: 200, height: 130, borderRadius: 8, background: "#F3F4F6",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 13, color: "#9CA3AF",
                          }}
                        >
                          немає фото
                        </div>
                      )}
                      <p style={{ fontSize: 15, fontWeight: 700, marginTop: 6 }}>
                        {value != null ? value.toLocaleString("uk-UA") : "—"}
                        {src && (
                          <span style={{ fontSize: 12, fontWeight: 400, color: "#6B7280" }}>
                            {" "}· {SOURCE_LABEL[src] ?? src}
                          </span>
                        )}
                      </p>
                      {tries > 1 && (
                        <p style={{ fontSize: 12, color: "#D97706" }}>перезнято {tries} рази</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Одне число зміни з підписом і поясненням під ним.
 *
 * Пояснення тут не окраса: «1.85» саме по собі не каже нічого, а
 * «у межах норми» під ним знімає питання, не змушуючи згадувати, який
 * бік добрий. Кольором — лише те, що виходить за межі.
 */
function Metric({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <div
      className="rounded-lg"
      style={{ background: "#F9FAFB", border: "1px solid #F3F4F6", padding: "8px 12px", minWidth: 118 }}
    >
      <p style={{ fontSize: 11, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.03em" }}>
        {label}
      </p>
      <p style={{ fontSize: 18, fontWeight: 700, color: color ?? "#0A0A0A", lineHeight: 1.2 }}>
        {value}
      </p>
      {hint && <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1 }}>{hint}</p>}
    </div>
  );
}

/**
 * Замовлення дня списком — поруч із картою, а не замість неї.
 *
 * Наведення на рядок збільшує відповідне кільце на карті. Без цього
 * зв'язку список і карта лишалися б двома окремими правдами: у списку
 * прізвище, на карті цятка, а зіставляти їх — очима, по тридцять разів.
 *
 * Час підписаний як «документ», і це принципово: у 1С він означає
 * момент проведення документа, а не візиту. Офіс проводить пачками —
 * вісім замовлень о 12:24 не означають, що торговий був у восьми місцях
 * одночасно. Співставляти з треком можна МІСЦЕ, але не хвилини.
 */
function OrdersList({
  orders,
  hoverId,
  onHover,
}: {
  orders: { dots: OrderDot[]; unmapped: number; total: number };
  hoverId: string | null;
  onHover: (id: string | null) => void;
}) {
  if (orders.total === 0) {
    return (
      <aside style={{ flex: "0 1 300px", minWidth: 240 }}>
        <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Замовлення дня</p>
        <div
          className="rounded-lg"
          style={{ border: "1px dashed #E5E7EB", background: "#F9FAFB", padding: 14 }}
        >
          <p style={{ fontSize: 13, color: "#9CA3AF", lineHeight: 1.6 }}>
            За цей день замовлень від клієнтів цього торгового немає.
            Кілометри є, результату — ні.
          </p>
        </div>
      </aside>
    );
  }

  const total = orders.dots.reduce((sum, o) => sum + o.amount, 0);

  return (
    <aside style={{ flex: "0 1 300px", minWidth: 240 }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 8 }}>
        <p style={{ fontSize: 13, fontWeight: 700 }}>Замовлення дня · {orders.total}</p>
        <span style={{ fontSize: 12, color: "#6B7280" }}>{money.format(total)} грн</span>
      </div>

      <div
        className="rounded-lg"
        style={{ border: "1px solid #E5E7EB", maxHeight: 430, overflowY: "auto" }}
      >
        {orders.dots.map((o) => {
          const on = hoverId === o.counterpartyId;
          return (
            <div
              key={`${o.number}-${o.counterpartyId}`}
              onMouseEnter={() => onHover(o.counterpartyId)}
              onMouseLeave={() => onHover(null)}
              style={{
                padding: "8px 10px",
                borderBottom: "1px solid #F3F4F6",
                background: on ? "#F5F3FF" : undefined,
                cursor: "default",
              }}
            >
              <div className="flex items-baseline gap-2">
                <span
                  aria-hidden
                  style={{
                    width: 9, height: 9, borderRadius: "50%", flex: "none",
                    background: o.draft ? "#fff" : "#7C3AED",
                    border: "2px solid #7C3AED",
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{o.name}</span>
              </div>
              <div className="flex items-baseline justify-between" style={{ marginTop: 2, paddingLeft: 17 }}>
                <span style={{ fontSize: 11, color: "#9CA3AF" }}>
                  документ {o.time}
                  {o.draft && " · не проведене"}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{money.format(o.amount)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {orders.unmapped > 0 && (
        <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6, lineHeight: 1.5 }}>
          Ще {orders.unmapped} замовлень у клієнтів без координат — на карту не лягли.
        </p>
      )}
    </aside>
  );
}

/**
 * Вирок за пробігом: скільки мав проїхати, скільки проїхав, наскільки більше.
 *
 * Блок свідомо великий і кольоровий лише коли поріг перетнуто. Жовта чи
 * червона панель на кожній зміні перестала б означати будь-що вже за
 * тиждень — тривожити має саме виняток.
 */
function PlanVerdict({
  plan,
  route,
}: {
  plan: Detail["plan"];
  route: NonNullable<Detail["plan"]["route"]>;
}) {
  const { overrun, deviation, thresholdPct } = plan;
  const exceeded = overrun?.exceeded ?? false;

  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: exceeded ? "#FEF2F2" : "#F0FDF4",
        border: `1px solid ${exceeded ? "#FECACA" : "#BBF7D0"}`,
      }}
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span style={{ fontSize: 14, fontWeight: 700 }}>{route.name}</span>
        <span style={{ fontSize: 12, color: "#6B7280" }}>
          {route.source === "DATE" ? "разове призначення" : "постійний розклад"}
          {route.stops.length > 0 && ` · ${route.stops.length} пункт(ів)`}
        </span>
      </div>

      {/* Скільки пунктів проїхав — окремим рядком від кілометрів.
          Недоїзд і перевитрата провини різні, і один відсоток приховав би
          обидві: можна об'їхати все й накрутити зайвого, а можна не
          перевищити жодного кілометра просто нікуди не поїхавши. */}
      {plan.coverage && (
        <p style={{ fontSize: 14, marginTop: 8 }}>
          Пунктів: <b>{plan.coverage.visited} з {plan.coverage.total}</b>
          {plan.coverage.missed.length > 0 && (
            <span style={{ color: "#B45309" }}>
              {" "}· не доїхав: {plan.coverage.missed.join(", ")}
            </span>
          )}
        </p>
      )}

      {overrun ? (
        <>
          <p style={{ fontSize: 14, marginTop: 8 }}>
            План <b>{overrun.plannedKm} км</b>
            {/* Показуємо саму арифметику: інакше 264 км виглядали б числом
                нізвідки, і перевірити його було б нічим. */}
            {plan.legs && plan.routeKm != null && (
              <span style={{ color: "#6B7280", fontSize: 13 }}>
                {" "}({plan.routeKm} маршрут + {plan.legs.totalKm} подача)
              </span>
            )}{" "}
            · Факт <b>{overrun.actualKm} км</b> ·{" "}
            <span style={{ color: exceeded ? "#DC2626" : "#16A34A", fontWeight: 700 }}>
              {overrun.extraKm >= 0 ? "+" : ""}
              {overrun.extraKm} км ({overrun.overrunPct >= 0 ? "+" : ""}
              {overrun.overrunPct}%)
            </span>
          </p>
          <p
            style={{
              fontSize: 13,
              marginTop: 4,
              color: exceeded ? "#991B1B" : "#166534",
              lineHeight: 1.5,
            }}
          >
            {exceeded
              ? `Перевищення понад ${thresholdPct}% — пробіг зміни не пояснюється призначеним маршрутом.`
              : `У межах норми (до ${thresholdPct}% понад план).`}
          </p>
        </>
      ) : (
        <p style={{ fontSize: 13, color: "#6B7280", marginTop: 8 }}>
          {/* Без планових км порівнювати нема з чим — і мовчати про це не можна:
              інакше «немає перевищення» читалося б як «усе добре». */}
          У маршруту не пораховані планові кілометри, тож перевитрату не
          порахувати. Карта нижче все одно накладе плановий напрямок.
        </p>
      )}

      {/* Без бази план занижений рівно на подачу — і мовчати про це не
          можна: інакше кожен, хто живе не в першому пункті, виглядав би
          винним просто за дорогу на роботу. */}
      {!plan.base && (
        <p style={{ fontSize: 13, marginTop: 8, color: "#B45309", lineHeight: 1.5 }}>
          Подача не врахована: у торгового не вказана база (звідки виїжджає).
          План занижений на дорогу до маршруту й назад. Адреса заводиться у
          вкладці «Логістика → Пальне».
        </p>
      )}
      {plan.base && !plan.legs && (
        <p style={{ fontSize: 13, marginTop: 8, color: "#B45309", lineHeight: 1.5 }}>
          Подачу не порахували: OSRM не відповів. План показано без неї —
          відкрийте зміну ще раз, щоб спробувати знову.
        </p>
      )}

      {deviation && (deviation.excursions.length > 0 || deviation.offRouteKm > 0) && (
        <p style={{ fontSize: 13, marginTop: 8, color: "#374151", lineHeight: 1.5 }}>
          Поза коридором ±{(plan.corridorM / 1000).toFixed(1)} км:{" "}
          <b>{deviation.offRouteKm} км</b>
          {deviation.excursions.length > 0 && (
            <>
              {" "}· значущих епізодів: <b>{deviation.excursions.length}</b> (
              {deviation.excursions
                .map((e) => `${e.fromTime}—${e.toTime}, ${e.km} км`)
                .join("; ")}
              )
            </>
          )}
        </p>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontWeight: 600, fontSize: 13, color: "#374151" };
const thR: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "10px 12px" };
const tdR: React.CSSProperties = { ...td, textAlign: "right" };
