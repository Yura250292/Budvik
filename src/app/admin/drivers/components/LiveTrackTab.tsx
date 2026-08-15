"use client";

/**
 * Хто зараз на маршруті — карта в реальному часі + звірка дня.
 *
 * Дві речі, яких не давав жоден звіт. Перша — «де зараз водій»: досі це
 * з'ясовували дзвінком. Друга — звірка трьох джерел за один день:
 * маршрутний лист 1С каже, скільки кілометрів і боргів планували, трек
 * каже, скільки проїхали насправді, відмітки — скільки грошей забрали.
 *
 * Пробіг по треку рахується по прямій між точками, тому він завжди
 * НИЖЧИЙ за дорогу. Відсоток показуємо, але висновок лишаємо людині:
 * поріг «скільки це нормально» залежить від маршруту, і вписувати його в
 * код зарано — спершу треба місяць реальних даних.
 */

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
// Пороги епізоду — з того самого модуля, що й рахує: підпис під
// відхиленнями не має розходитися з логікою.
import { EXCURSION_MIN_MINUTES, EXCURSION_MIN_KM } from "@/lib/sales/deviation";
import { TrackHealthCard } from "./TrackHealthCard";

const TrackDayMap = dynamic(() => import("@/components/map/TrackDayMap"), {
  ssr: false,
  loading: () => <div style={{ height: "460px", background: "#EEE", borderRadius: "12px" }} />,
});

type Person = {
  userId: string;
  name: string;
  role: string;
  color: string | null;
  lat: number;
  lng: number;
  speedKmh: number | null;
  lastPointAt: string;
  minutesAgo: number;
  online: boolean;
  distanceKm: number;
  pointsCount: number;
};

type DayDetail = {
  user: { id: string; name: string; role: string };
  track: {
    distanceKm: number;
    pointsCount: number;
    startedAt: string | null;
    lastPointAt: string | null;
    points: Array<{ lat: number; lng: number; recordedAt: string; speedKmh: number | null }>;
    /** Лінія з добитими розривами — нею й малюємо трек. */
    path: Array<[number, number]>;
  };
  /** Призначений маршрут торгового на цей день. У водія null. */
  plan: {
    templateId: string;
    name: string;
    color: string | null;
    totalDistanceKm: number | null;
    geometry: unknown;
    stops: Array<{ settlement: string; displayName: string | null; lat: number; lng: number; seq: number }>;
    source: "DATE" | "WEEKDAY";
  } | null;
  deviation: {
    hasRoute: boolean;
    onRouteRatio: number | null;
    offRouteKm: number;
    excursions: Array<{
      from: string;
      to: string;
      minutes: number;
      km: number;
      maxDistanceM: number;
      lat: number;
      lng: number;
    }>;
    pointsAnalyzed: number;
  } | null;
  corridorM: number;
  /** Чи план мав справжню геометрію доріг, а не прямі між пунктами */
  planFromGeometry: boolean;
  route: {
    source: string;
    number: string | null;
    stops: Array<{
      key: string;
      name: string;
      lat: number | null;
      lng: number | null;
      sequence: number;
      debtAmount: number;
      visit: { status: string; collectedAmount: number | null } | null;
    }>;
  };
  visits: Array<{
    id: string;
    status: string;
    comment: string | null;
    collectedAmount: number | null;
    markedAt: string;
    counterparty: { name: string };
  }>;
  sheet1C: {
    number: string;
    distanceKm: number;
    ordersTotal: number;
    debtsTotal: number;
    collected: number;
  } | null;
};

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/** Як часто перепитуємо, хто де. Частіше немає сенсу: планшет шле пачку раз на 25 с. */
const POLL_MS = 30_000;

function kyivToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
}

/** Час епізоду в «14:05» за Києвом. */
function kyivClock(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function LiveTrackTab() {
  const [day, setDay] = useState(kyivToday);
  const [people, setPeople] = useState<Person[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLive = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/track/live?day=${day}`);
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      setPeople(json.people ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити");
    }
  }, [day]);

  useEffect(() => {
    void loadLive();
  }, [loadLive]);

  // Опитування лише на сьогоднішній день: минулі дні не змінюються.
  useEffect(() => {
    if (day !== kyivToday()) return;
    const id = window.setInterval(() => void loadLive(), POLL_MS);
    return () => window.clearInterval(id);
  }, [day, loadLive]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let alive = true;
    fetch(`/api/admin/track/${selected}/day?day=${day}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error ?? `Помилка ${r.status}`);
        return j as DayDetail;
      })
      .then((j) => alive && setDetail(j))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Не вдалося завантажити день"));
    return () => {
      alive = false;
    };
  }, [selected, day]);

  const isToday = day === kyivToday();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            setSelected(null);
          }}
          className="rounded-lg px-3 py-2"
          style={{ border: "1px solid #E5E7EB", fontSize: "14px" }}
        />
        {isToday && (
          <span style={{ fontSize: "13px", color: "#6B7280" }}>
            Оновлюється кожні 30 с · {people.filter((p) => p.online).length} на маршруті
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-xl p-3" style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}>
          <p style={{ fontSize: "13px", color: "#B91C1C" }}>{error}</p>
        </div>
      )}

      {people.length === 0 ? (
        <div
          className="rounded-xl p-6 text-center"
          style={{ background: "#F9FAFB", border: "1px solid #E5E7EB" }}
        >
          <p style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A" }}>
            {isToday ? "Сьогодні ще ніхто не виїхав" : "Цього дня треків немає"}
          </p>
          <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "6px", lineHeight: 1.5 }}>
            Трек пишеться, коли водій відкриває «Карту дня» на планшеті.
          </p>
        </div>
      ) : (
        <>
          {/* Рамку й скруглення тримає сама карта (MapFrame) — другий
              контейнер із overflow тут лише подвоював би заокруглення. */}
          <div style={{ border: "1px solid #E5E7EB", borderRadius: "12px" }}>
            <TrackDayMap
              people={people}
              selectedId={selected}
              detail={
                detail
                  ? {
                      points: detail.track.points,
                      path: detail.track.path,
                      stops: detail.route.stops,
                      plan: detail.plan,
                      excursions: detail.deviation?.excursions ?? [],
                    }
                  : null
              }
              onSelect={setSelected}
            />
          </div>

          {/* Самоперевірка треку — згорнута, поки не знадобиться. На час
              обкатки застосунку це головна діагностика: чи писав пристрій
              рівно, чи половину дня спав. */}
          {selected && <TrackHealthCard userId={selected} day={day} />}

          {detail?.plan && (
            <div className="rounded-xl p-4" style={{ border: "1px solid #E5E7EB", background: "#fff" }}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" style={{ marginBottom: "10px" }}>
                <span style={{ fontSize: "14px", fontWeight: 700 }}>
                  План: {detail.plan.name}
                </span>
                <span style={{ fontSize: "12px", color: "#6B7280" }}>
                  {detail.plan.source === "DATE" ? "разове призначення" : "постійний розклад"}
                  {detail.plan.totalDistanceKm != null && ` · ${detail.plan.totalDistanceKm} км`}
                  {` · ${detail.plan.stops.length} пунктів`}
                </span>
              </div>

              {/* Три цифри, які й відповідають на питання «чи їздив за планом» */}
              <div className="flex flex-wrap gap-x-6 gap-y-2" style={{ fontSize: "13px" }}>
                <span>
                  У коридорі:{" "}
                  <b
                    style={{
                      color:
                        detail.deviation?.onRouteRatio == null
                          ? "#6B7280"
                          : detail.deviation.onRouteRatio < 0.6
                            ? "#DC2626"
                            : "#16A34A",
                    }}
                  >
                    {detail.deviation?.onRouteRatio == null
                      ? "—"
                      : `${Math.round(detail.deviation.onRouteRatio * 100)}%`}
                  </b>
                </span>
                <span>
                  Поза маршрутом:{" "}
                  <b style={{ color: (detail.deviation?.offRouteKm ?? 0) > 0 ? "#DC2626" : "#16A34A" }}>
                    {detail.deviation?.offRouteKm ?? 0} км
                  </b>
                </span>
                <span style={{ color: "#6B7280" }}>
                  Коридор: {Math.round(detail.corridorM / 100) / 10} км
                </span>
              </div>

              {detail.deviation && detail.deviation.excursions.length > 0 && (
                <div
                  className="rounded-lg p-3"
                  style={{ background: "#FEF2F2", border: "1px solid #FECACA", marginTop: "12px" }}
                >
                  <p style={{ fontSize: "13px", fontWeight: 700, color: "#991B1B", marginBottom: "6px" }}>
                    Виїзди за межі маршруту: {detail.deviation.excursions.length}
                  </p>
                  <div className="space-y-1">
                    {detail.deviation.excursions.map((e, i) => (
                      <p key={i} style={{ fontSize: "13px", color: "#7F1D1D" }}>
                        {kyivClock(e.from)}—{kyivClock(e.to)} · {e.minutes} хв · {e.km} км ·
                        найдалі {Math.round(e.maxDistanceM / 100) / 10} км від маршруту
                      </p>
                    ))}
                  </div>
                  {/* Дисклеймер обов'язковий: цифри — привід спитати, а не доказ */}
                  <p style={{ fontSize: "12px", color: "#9F1239", marginTop: "8px", lineHeight: 1.5 }}>
                    Корки й короткі об&apos;їзди сюди не потрапляють: епізод рахується
                    від {EXCURSION_MIN_MINUTES} хв і {EXCURSION_MIN_KM} км поза коридором.
                    Це привід уточнити в торгового, а не готовий висновок.
                  </p>
                </div>
              )}

              {!detail.planFromGeometry && (
                <p style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "10px", lineHeight: 1.5 }}>
                  У цього напрямку немає збереженої геометрії доріг, тому план —
                  прямі між пунктами, а коридор розширено вдвічі. Відхилення на
                  вигинах траси тут не рахуються.
                </p>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid #E5E7EB" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
              <thead>
                <tr style={{ background: "#F9FAFB" }}>
                  <th style={th}>Хто</th>
                  <th style={th}>Стан</th>
                  <th style={thR}>Трек, км</th>
                  <th style={thR}>1С, км</th>
                  <th style={thR}>Відхилення</th>
                  <th style={thR}>Зібрано</th>
                  <th style={thR}>Точки</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const mine = selected === p.userId;
                  const sheet = mine ? detail?.sheet1C : null;
                  // Трек по прямій завжди коротший за дорогу, тому
                  // від'ємне відхилення — норма, а додатне питання.
                  const deviation =
                    sheet && sheet.distanceKm > 0
                      ? Math.round(((p.distanceKm - sheet.distanceKm) / sheet.distanceKm) * 100)
                      : null;
                  return (
                    <tr
                      key={p.userId}
                      onClick={() => setSelected(mine ? null : p.userId)}
                      style={{
                        borderTop: "1px solid #F3F4F6",
                        cursor: "pointer",
                        background: mine ? "#F0F9FF" : "#fff",
                      }}
                    >
                      <td style={td}>
                        <span style={{ fontWeight: 600 }}>{p.name}</span>
                        <span style={{ color: "#9CA3AF", marginLeft: "6px", fontSize: "12px" }}>
                          {p.role === "DRIVER" ? "водій" : "торговий"}
                        </span>
                      </td>
                      <td style={td}>
                        <span
                          className="inline-flex items-center gap-1.5"
                          style={{ fontSize: "13px", color: p.online ? "#16A34A" : "#9CA3AF" }}
                        >
                          <span
                            aria-hidden
                            style={{
                              width: "8px",
                              height: "8px",
                              borderRadius: "50%",
                              background: p.online ? "#16A34A" : "#D1D5DB",
                            }}
                          />
                          {p.online
                            ? p.speedKmh != null && p.speedKmh > 5
                              ? `їде ${p.speedKmh} км/год`
                              : "на місці"
                            : `${p.minutesAgo} хв тому`}
                        </span>
                      </td>
                      <td style={tdR}>{p.distanceKm}</td>
                      <td style={tdR}>{sheet ? sheet.distanceKm : "—"}</td>
                      <td style={{ ...tdR, color: deviation != null && deviation > 0 ? "#DC2626" : "#6B7280" }}>
                        {deviation != null ? `${deviation > 0 ? "+" : ""}${deviation}%` : "—"}
                      </td>
                      <td style={tdR}>
                        {sheet ? `${money.format(sheet.collected)} / ${money.format(sheet.debtsTotal)}` : "—"}
                      </td>
                      <td style={tdR}>{p.pointsCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {detail && detail.visits.length > 0 && (
            <div className="rounded-xl p-4" style={{ border: "1px solid #E5E7EB", background: "#fff" }}>
              <p style={{ fontSize: "14px", fontWeight: 700, marginBottom: "8px" }}>
                Відмітки: {detail.user.name}
              </p>
              <div className="space-y-1.5">
                {detail.visits.map((v) => (
                  <div key={v.id} className="flex flex-wrap items-baseline gap-2" style={{ fontSize: "13px" }}>
                    <span style={{ color: v.status === "DONE" ? "#16A34A" : "#DC2626", fontWeight: 700 }}>
                      {v.status === "DONE" ? "✓" : "×"}
                    </span>
                    <span style={{ fontWeight: 600 }}>{v.counterparty.name}</span>
                    {v.collectedAmount != null && v.collectedAmount > 0 && (
                      <span style={{ color: "#16A34A" }}>{money.format(v.collectedAmount)} грн</span>
                    )}
                    {v.comment && <span style={{ color: "#6B7280" }}>— {v.comment}</span>}
                    <span style={{ color: "#9CA3AF", marginLeft: "auto", fontSize: "12px" }}>
                      {new Intl.DateTimeFormat("uk-UA", {
                        timeZone: "Europe/Kyiv",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(v.markedAt))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p style={{ fontSize: "12px", color: "#9CA3AF", lineHeight: 1.5 }}>
            Пробіг по треку рахується по прямій між точками, тому він завжди менший
            за реальну дорогу — від&apos;ємне відхилення від 1С нормальне. Питання
            викликає додатне: кілометри, яких немає в маршрутному листі.
          </p>
        </>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: "12px",
  fontWeight: 600,
  color: "#6B7280",
  whiteSpace: "nowrap",
};
const thR: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "10px 12px", whiteSpace: "nowrap" };
const tdR: React.CSSProperties = { ...td, textAlign: "right" };
