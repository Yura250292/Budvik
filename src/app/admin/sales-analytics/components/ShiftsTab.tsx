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

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { Period } from "@/components/ui/PeriodPicker";

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
};

type Detail = {
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
};

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
  const [summary, setSummary] = useState<{ count: number; totalKm: number; suspicious: number; autoClosed: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
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
      if (alive && res.ok) setDetail(json);
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
        <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid #E5E7EB" }}>
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
                    style={{
                      borderTop: "1px solid #F3F4F6",
                      cursor: "pointer",
                      background: mine ? "#F0F9FF" : s.odometerSuspicious ? "#FFFBEB" : undefined,
                    }}
                  >
                    <td style={td}>{s.name}</td>
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
        </div>
      )}

      {detail && (
        <div className="rounded-xl p-4 space-y-4" style={{ border: "1px solid #E5E7EB", background: "#fff" }}>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span style={{ fontSize: 15, fontWeight: 700 }}>{detail.user.name}</span>
            <span style={{ fontSize: 13, color: "#6B7280" }}>
              {time(detail.shift.startedAt)}
              {detail.shift.endedAt && ` — ${time(detail.shift.endedAt)}`}
              {detail.shift.durationMinutes != null &&
                ` · ${Math.floor(detail.shift.durationMinutes / 60)} год ${detail.shift.durationMinutes % 60} хв`}
            </span>
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

          {/* Фото одометра поруч: перше й останнє, що бачить перевіряльник */}
          <div className="flex flex-wrap gap-4">
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

          {detail.track.shift.pointsCount > 0 || detail.track.afterShift.pointsCount > 0 ? (
            <>
              <ShiftTrackMap
                shiftPath={detail.track.shift.path}
                afterShiftPath={detail.track.afterShift.path}
                height="420px"
              />
              <div className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: 13 }}>
                <span>
                  <span style={{ display: "inline-block", width: 22, height: 3, background: "#2563EB", verticalAlign: "middle", marginRight: 6 }} />
                  Трек зміни ({detail.track.shift.pointsCount} точок)
                </span>
                {detail.track.afterShift.pointsCount > 0 && (
                  <span>
                    <span style={{ display: "inline-block", width: 22, height: 3, background: "#DC2626", verticalAlign: "middle", marginRight: 6 }} />
                    Після зміни ({detail.track.afterShift.pointsCount} точок)
                  </span>
                )}
              </div>
            </>
          ) : (
            <p style={{ fontSize: 13, color: "#9CA3AF" }}>
              Треку немає: застосунок не встиг надіслати точки або трекінг був вимкнений.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontWeight: 600, fontSize: 13, color: "#374151" };
const thR: React.CSSProperties = { ...th, textAlign: "right" };
const td: React.CSSProperties = { padding: "10px 12px" };
const tdR: React.CSSProperties = { ...td, textAlign: "right" };
