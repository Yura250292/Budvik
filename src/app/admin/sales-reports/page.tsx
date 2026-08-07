"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import DynamicShiftMap from "@/components/map/DynamicShiftMap";
import type { ShiftPoint } from "@/components/map/ShiftMap";

type Tab = "overview" | "reps" | "trips" | "checkpoints" | "map" | "workers";

const CARD = {
  background: "white",
  borderRadius: "var(--radius-card, 12px)",
  border: "1px solid #E5E7EB",
};

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  OPEN: { bg: "#EFF6FF", color: "#2563EB", label: "Триває" },
  CLOSED: { bg: "#F0FDF4", color: "#16A34A", label: "Завершено" },
  ABANDONED: { bg: "#FEF2F2", color: "#DC2626", label: "Не завершено" },
};

/** Джерело показань одометра — головна ознака якості AI. */
const SOURCE_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  AI: { bg: "#F3F4F6", color: "#6B7280", label: "AI" },
  MANUAL: { bg: "#FEF3C7", color: "#D97706", label: "вручну" },
  CORRECTED: { bg: "#FEE2E2", color: "#DC2626", label: "виправлено" },
};

const KYIV_TZ = "Europe/Kyiv";

function kyivDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: KYIV_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function periodRange(period: string): { from: string; to: string } | null {
  const now = new Date();
  const to = kyivDateStr(now);
  const start = new Date(now);

  switch (period) {
    case "today":
      return { from: to, to };
    case "week":
      start.setDate(start.getDate() - 7);
      break;
    case "month":
      start.setMonth(start.getMonth() - 1);
      break;
    case "quarter":
      start.setMonth(start.getMonth() - 3);
      break;
    case "year":
      start.setFullYear(start.getFullYear() - 1);
      break;
    default:
      return null;
  }
  return { from: kyivDateStr(start), to };
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: KYIV_TZ,
  });
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("uk-UA", { timeZone: KYIV_TZ });
}

function formatKm(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("uk-UA").format(value);
}

function formatMinutes(value: number | null): string {
  if (value == null) return "—";
  const h = Math.floor(value / 60);
  const m = value % 60;
  return h ? `${h} год ${m} хв` : `${m} хв`;
}

function formatHours(value: number): string {
  return `${value.toFixed(1)} год`;
}

interface Checkpoint {
  id: string;
  seq: number;
  lat: number;
  lng: number;
  address: string | null;
  createdAt: string;
  minutesFromPrev: number | null;
  metersFromPrev: number | null;
  tripId?: string;
  userName?: string;
}

interface Trip {
  id: string;
  userId: string;
  userName: string;
  status: string;
  startedAt: string;
  startAddress: string | null;
  startLat: number | null;
  startLng: number | null;
  startOdometer: number | null;
  startOdometerSource: string | null;
  endedAt: string | null;
  endAddress: string | null;
  endLat: number | null;
  endLng: number | null;
  endOdometer: number | null;
  endOdometerSource: string | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  checkpointsCount: number;
  odometerSuspicious: boolean;
  checkpoints: Checkpoint[];
}

interface RepRow {
  id: string;
  name: string;
  onTrip: boolean;
  tripsCount: number;
  abandonedCount: number;
  daysWorked: number;
  totalKm: number;
  kmPerDay: number;
  checkpointsCount: number;
  checkpointsPerDay: number;
  kmPerCheckpoint: number | null;
  totalHours: number;
  avgTripHours: number;
  avgFirstCheckpointMinutes: number | null;
  avgGapMinutes: number | null;
  suspiciousCount: number;
  manualOdometerRate: number | null;
}

interface Data {
  kpis: {
    tripsCount: number;
    closedCount: number;
    openCount: number;
    abandonedCount: number;
    totalKm: number;
    checkpointsCount: number;
    totalHours: number;
    repsCount: number;
    suspiciousCount: number;
  };
  workers: RepRow[];
  teamAvg: {
    kmPerDay: number;
    checkpointsPerDay: number;
    kmPerCheckpoint: number | null;
    avgTripHours: number;
  } | null;
  daily: { date: string; km: number; trips: number; checkpoints: number }[];
  hourly: { hour: number; count: number }[];
  repsList: { id: string; name: string; telegramId: string | null }[];
  trips: Trip[];
  checkpoints: Checkpoint[];
}

export default function SalesReportsPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const [tab, setTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState("month");
  const [repFilter, setRepFilter] = useState("ALL");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const range = periodRange(period);
    const params = new URLSearchParams();
    if (range) {
      params.set("from", range.from);
      params.set("to", range.to);
    }
    if (repFilter !== "ALL") params.set("repId", repFilter);

    setLoading(true);
    try {
      const res = await fetch(`/api/admin/sales-reports?${params}`);
      setData(res.ok ? await res.json() : null);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [period, repFilter]);

  useEffect(() => {
    if (role === "ADMIN" || role === "MANAGER") fetchData();
  }, [role, fetchData]);

  const mapPoints = useMemo<ShiftPoint[]>(() => {
    if (!data) return [];
    const points: ShiftPoint[] = [];

    data.trips.forEach((t) => {
      if (t.startLat != null && t.startLng != null) {
        points.push({
          lat: t.startLat,
          lng: t.startLng,
          type: "open",
          workerName: t.userName,
          time: `${formatDate(t.startedAt)} ${formatTime(t.startedAt)}`,
          address: t.startAddress,
          shiftId: t.id,
        });
      }
      t.checkpoints.forEach((c) => {
        points.push({
          lat: c.lat,
          lng: c.lng,
          type: "checkpoint",
          workerName: t.userName,
          time: formatTime(c.createdAt),
          address: c.address,
          shiftId: t.id,
          seq: c.seq,
        });
      });
      if (t.endLat != null && t.endLng != null) {
        points.push({
          lat: t.endLat,
          lng: t.endLng,
          type: "close",
          workerName: t.userName,
          time: formatTime(t.endedAt),
          address: t.endAddress,
          shiftId: t.id,
        });
      }
    });

    return points;
  }, [data]);

  if (role !== "ADMIN" && role !== "MANAGER") {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-bk">Доступ заборонено</h1>
        <p className="text-g400 mt-2 text-sm">У вас немає доступу до цього розділу</p>
      </div>
    );
  }

  const maxDailyKm = Math.max(1, ...(data?.daily.map((d) => d.km) || [1]));
  const maxHourly = Math.max(1, ...(data?.hourly.map((h) => h.count) || [1]));
  const maxRepKm = Math.max(1, ...(data?.workers.map((w) => w.totalKm) || [1]));

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-white border-b border-g200 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Link
            href="/admin/reports"
            className="w-9 h-9 rounded-[var(--radius-btn)] bg-primary flex items-center justify-center flex-shrink-0"
            aria-label="Назад до звітів"
          >
            <svg className="w-4 h-4 text-bk" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-bk leading-tight">Звіти торгових</h1>
            <p className="text-xs text-g400">Поїздки, пробіг і відвідані точки</p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
        {/* Вкладки */}
        <div
          style={{
            display: "flex",
            gap: "4px",
            background: "#F3F4F6",
            padding: "4px",
            borderRadius: "10px",
            marginBottom: "16px",
            overflowX: "auto",
          }}
        >
          {(
            [
              ["overview", "Огляд"],
              ["reps", "Торгові"],
              ["trips", "Поїздки"],
              ["checkpoints", "Точки"],
              ["map", "Карта"],
              ["workers", "Підключення"],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                flex: "0 0 auto",
                padding: "7px 14px",
                borderRadius: "8px",
                border: "none",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
                background: tab === key ? "white" : "transparent",
                color: tab === key ? "#0A0A0A" : "#6B7280",
                boxShadow: tab === key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Фільтри */}
        {tab !== "workers" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
            <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
              {(
                [
                  ["today", "Сьогодні"],
                  ["week", "Тиждень"],
                  ["month", "Місяць"],
                  ["quarter", "Квартал"],
                  ["year", "Рік"],
                  ["all", "Увесь час"],
                ] as [string, string][]
              ).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setPeriod(key)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "8px",
                    border: "1px solid #E5E7EB",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    background: period === key ? "#0A0A0A" : "white",
                    color: period === key ? "white" : "#6B7280",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <select
              value={repFilter}
              onChange={(e) => setRepFilter(e.target.value)}
              style={{
                padding: "6px 10px",
                borderRadius: "8px",
                border: "1px solid #E5E7EB",
                fontSize: "12px",
                background: "white",
              }}
            >
              <option value="ALL">Усі торгові</option>
              {data?.repsList.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {loading && <p style={{ color: "#6B7280", fontSize: "14px" }}>Завантаження...</p>}

        {!loading && !data && (
          <div style={{ ...CARD, padding: "32px", textAlign: "center", color: "#6B7280" }}>
            Не вдалося завантажити дані
          </div>
        )}

        {!loading && data && tab === "overview" && (
          <>
            <div
              style={{
                display: "grid",
                gap: "10px",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                marginBottom: "16px",
              }}
            >
              {[
                ["Пробіг", `${formatKm(data.kpis.totalKm)} км`],
                ["Поїздок", String(data.kpis.tripsCount)],
                ["Точок", String(data.kpis.checkpointsCount)],
                ["Годин у дорозі", formatHours(data.kpis.totalHours)],
                ["Торгових", String(data.kpis.repsCount)],
                ["Перевірити", String(data.kpis.suspiciousCount)],
              ].map(([label, value]) => (
                <div key={label} style={{ ...CARD, padding: "14px" }}>
                  <div style={{ fontSize: "11px", color: "#6B7280", marginBottom: "4px" }}>{label}</div>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "#0A0A0A" }}>{value}</div>
                </div>
              ))}
            </div>

            {(data.kpis.openCount > 0 || data.kpis.abandonedCount > 0) && (
              <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
                {data.kpis.openCount > 0 && (
                  <span style={{ background: "#EFF6FF", color: "#2563EB", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600 }}>
                    🚗 Зараз у дорозі: {data.kpis.openCount}
                  </span>
                )}
                {data.kpis.abandonedCount > 0 && (
                  <span style={{ background: "#FEF2F2", color: "#DC2626", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600 }}>
                    ⚠️ Не завершено: {data.kpis.abandonedCount}
                  </span>
                )}
              </div>
            )}

            {data.daily.length > 0 && (
              <div style={{ ...CARD, padding: "16px", marginBottom: "16px" }}>
                <h3 style={{ fontSize: "13px", fontWeight: 600, marginBottom: "12px" }}>Пробіг по днях</h3>
                <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", height: "120px" }}>
                  {data.daily.map((d) => (
                    <div
                      key={d.date}
                      title={`${d.date}: ${formatKm(d.km)} км, ${d.trips} поїздок`}
                      style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}
                    >
                      <div
                        style={{
                          height: `${(d.km / maxDailyKm) * 100}%`,
                          background: "#FFD600",
                          borderRadius: "3px 3px 0 0",
                          minHeight: d.km > 0 ? "3px" : "0",
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ ...CARD, padding: "16px" }}>
              <h3 style={{ fontSize: "13px", fontWeight: 600, marginBottom: "12px" }}>
                Відвідування по годинах доби
              </h3>
              <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "100px" }}>
                {data.hourly.map((h) => (
                  <div key={h.hour} title={`${h.hour}:00 — ${h.count}`} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%" }}>
                    <div
                      style={{
                        height: `${(h.count / maxHourly) * 100}%`,
                        background: "#FFD600",
                        borderRadius: "2px 2px 0 0",
                        minHeight: h.count > 0 ? "2px" : "0",
                      }}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#9CA3AF", marginTop: "4px" }}>
                <span>0:00</span>
                <span>12:00</span>
                <span>23:00</span>
              </div>
            </div>
          </>
        )}

        {!loading && data && tab === "reps" && (
          <>
            {data.teamAvg && (
              <div style={{ ...CARD, padding: "14px", marginBottom: "12px", background: "#EFF6FF", borderColor: "#BFDBFE" }}>
                <div style={{ fontSize: "12px", color: "#1E40AF", lineHeight: 1.6 }}>
                  <strong>Середнє по команді:</strong> {formatKm(data.teamAvg.kmPerDay)} км/день ·{" "}
                  {data.teamAvg.checkpointsPerDay} точок/день ·{" "}
                  {data.teamAvg.kmPerCheckpoint != null ? `${data.teamAvg.kmPerCheckpoint} км на точку` : "—"} ·{" "}
                  {data.teamAvg.avgTripHours} год на поїздку
                  <br />
                  <span style={{ color: "#3B82F6" }}>
                    «км на точку» — скільки кілометрів коштує один візит. Високе значення означає багато
                    переїздів заради малої кількості клієнтів.
                  </span>
                </div>
              </div>
            )}

            <div style={{ ...CARD, overflow: "hidden" }}>
              {data.workers.length === 0 && (
                <div style={{ padding: "32px", textAlign: "center", color: "#6B7280", fontSize: "14px" }}>
                  За цей період поїздок не було
                </div>
              )}
              {data.workers.map((w, i) => (
                <div key={w.id} style={{ padding: "14px 16px", borderTop: i ? "1px solid #F3F4F6" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                    <span style={{ fontSize: "12px", color: "#9CA3AF", fontWeight: 700, minWidth: "18px" }}>
                      {i + 1}
                    </span>
                    {w.onTrip && (
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#16A34A" }} title="Зараз у дорозі" />
                    )}
                    <strong style={{ fontSize: "14px" }}>{w.name}</strong>
                    <span style={{ marginLeft: "auto", fontSize: "14px", fontWeight: 700 }}>
                      {formatKm(w.totalKm)} км
                    </span>
                  </div>

                  <div style={{ height: "6px", background: "#F3F4F6", borderRadius: "3px", marginBottom: "8px" }}>
                    <div style={{ width: `${(w.totalKm / maxRepKm) * 100}%`, height: "100%", background: "#FFD600", borderRadius: "3px" }} />
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", fontSize: "11px", color: "#6B7280" }}>
                    <span>🚗 {w.tripsCount} поїздок</span>
                    <span>📅 {w.daysWorked} днів</span>
                    <span>🛣 {formatKm(w.kmPerDay)} км/день</span>
                    <span>📍 {w.checkpointsCount} точок ({w.checkpointsPerDay}/день)</span>
                    {w.kmPerCheckpoint != null && <span>📊 {w.kmPerCheckpoint} км на точку</span>}
                    <span>⏱ {formatHours(w.totalHours)}</span>
                    {w.avgFirstCheckpointMinutes != null && (
                      <span>🕐 до 1-ї точки ~{formatMinutes(w.avgFirstCheckpointMinutes)}</span>
                    )}
                    {w.avgGapMinutes != null && <span>⏳ між точками ~{formatMinutes(w.avgGapMinutes)}</span>}
                    {w.manualOdometerRate != null && w.manualOdometerRate > 0 && (
                      <span style={{ color: "#D97706" }}>✍️ {w.manualOdometerRate}% одометра вручну</span>
                    )}
                    {w.suspiciousCount > 0 && (
                      <span style={{ color: "#DC2626" }}>⚠️ {w.suspiciousCount} перевірити</span>
                    )}
                    {w.abandonedCount > 0 && (
                      <span style={{ color: "#DC2626" }}>❌ {w.abandonedCount} не завершено</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && data && tab === "trips" && (
          <div style={{ ...CARD, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#FAFAFA" }}>
                    {["Дата", "Торговий", "Старт", "Фініш", "Одометр", "Км", "Точок", "Тривалість", "Статус"].map((h) => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "11px", whiteSpace: "nowrap" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.trips.length === 0 && (
                    <tr>
                      <td colSpan={9} style={{ padding: "32px", textAlign: "center", color: "#6B7280" }}>
                        За цей період поїздок не було
                      </td>
                    </tr>
                  )}
                  {data.trips.map((t) => {
                    const st = STATUS_STYLE[t.status] || STATUS_STYLE.OPEN;
                    const isOpen = expanded === t.id;
                    return (
                      // Фрагмент з ключем: рядок поїздки + рядок з точками
                      <Fragment key={t.id}>
                        <tr
                          onClick={() => setExpanded(isOpen ? null : t.id)}
                          style={{ borderTop: "1px solid #F3F4F6", cursor: "pointer", background: isOpen ? "#FAFAFA" : undefined }}
                        >
                          <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{formatDate(t.startedAt)}</td>
                          <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{t.userName}</td>
                          <td style={{ padding: "10px 12px", color: "#16A34A", whiteSpace: "nowrap" }}>
                            {formatTime(t.startedAt)}
                            {t.startAddress && (
                              <div style={{ fontSize: "11px", color: "#9CA3AF" }}>{t.startAddress}</div>
                            )}
                          </td>
                          <td style={{ padding: "10px 12px", color: "#DC2626", whiteSpace: "nowrap" }}>
                            {t.endedAt ? formatTime(t.endedAt) : "у дорозі"}
                            {t.endAddress && (
                              <div style={{ fontSize: "11px", color: "#9CA3AF" }}>{t.endAddress}</div>
                            )}
                          </td>
                          <td style={{ padding: "10px 12px", whiteSpace: "nowrap", fontSize: "12px" }}>
                            {formatKm(t.startOdometer)} → {formatKm(t.endOdometer)}
                            <div style={{ display: "flex", gap: "4px", marginTop: "2px" }}>
                              {[t.startOdometerSource, t.endOdometerSource].map((src, idx) =>
                                src ? (
                                  <span
                                    key={idx}
                                    style={{
                                      fontSize: "10px",
                                      padding: "1px 5px",
                                      borderRadius: "4px",
                                      fontWeight: 600,
                                      background: SOURCE_STYLE[src]?.bg,
                                      color: SOURCE_STYLE[src]?.color,
                                    }}
                                  >
                                    {SOURCE_STYLE[src]?.label}
                                  </span>
                                ) : null
                              )}
                            </div>
                          </td>
                          <td style={{ padding: "10px 12px", fontWeight: 700, whiteSpace: "nowrap" }}>
                            {formatKm(t.distanceKm)}
                            {t.odometerSuspicious && <span title="Перевірити показання"> ⚠️</span>}
                          </td>
                          <td style={{ padding: "10px 12px" }}>{t.checkpointsCount}</td>
                          <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{formatMinutes(t.durationMinutes)}</td>
                          <td style={{ padding: "10px 12px" }}>
                            <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "6px", fontWeight: 600, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>
                              {st.label}
                            </span>
                          </td>
                        </tr>
                        {isOpen && t.checkpoints.length > 0 && (
                          <tr>
                            <td colSpan={9} style={{ padding: "0 12px 14px", background: "#FAFAFA" }}>
                              <div style={{ fontSize: "12px", fontWeight: 600, margin: "8px 0" }}>
                                Точки маршруту
                              </div>
                              <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
                                <tbody>
                                  {t.checkpoints.map((c) => (
                                    <tr key={c.id} style={{ borderTop: "1px solid #E5E7EB" }}>
                                      <td style={{ padding: "6px 8px", width: "36px", fontWeight: 700, color: "#2563EB" }}>
                                        {c.seq}
                                      </td>
                                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{formatTime(c.createdAt)}</td>
                                      <td style={{ padding: "6px 8px" }}>{c.address || "—"}</td>
                                      <td style={{ padding: "6px 8px", color: "#6B7280", whiteSpace: "nowrap" }}>
                                        {c.minutesFromPrev != null ? `+${formatMinutes(c.minutesFromPrev)}` : ""}
                                        {c.metersFromPrev != null
                                          ? ` · ${c.metersFromPrev >= 1000 ? (c.metersFromPrev / 1000).toFixed(1) + " км" : c.metersFromPrev + " м"}`
                                          : ""}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && data && tab === "checkpoints" && (
          <div style={{ ...CARD, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#FAFAFA" }}>
                    {["Дата", "Час", "Торговий", "№", "Адреса", "Від попередньої"].map((h) => (
                      <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "11px" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.checkpoints.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: "32px", textAlign: "center", color: "#6B7280" }}>
                        Точок за цей період немає
                      </td>
                    </tr>
                  )}
                  {data.checkpoints.map((c) => (
                    <tr key={c.id} style={{ borderTop: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{formatDate(c.createdAt)}</td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{formatTime(c.createdAt)}</td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{c.userName}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: "#2563EB" }}>{c.seq}</td>
                      <td style={{ padding: "10px 12px" }}>{c.address || "—"}</td>
                      <td style={{ padding: "10px 12px", color: "#6B7280", whiteSpace: "nowrap" }}>
                        {c.minutesFromPrev != null ? formatMinutes(c.minutesFromPrev) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && data && tab === "map" && (
          <div style={{ ...CARD, padding: "16px" }}>
            <div style={{ display: "flex", gap: "14px", marginBottom: "12px", fontSize: "12px", color: "#6B7280", flexWrap: "wrap" }}>
              <span>🟢 Старт поїздки</span>
              <span>🔵 Точка візиту</span>
              <span>🔴 Фініш</span>
            </div>
            {mapPoints.length === 0 ? (
              <div style={{ padding: "32px", textAlign: "center", color: "#6B7280", fontSize: "14px" }}>
                Немає точок для показу
              </div>
            ) : (
              <DynamicShiftMap points={mapPoints} connectRoute />
            )}
          </div>
        )}

        {!loading && tab === "workers" && <WorkersTab />}
      </div>
    </div>
  );
}

// ---------- Вкладка підключення ----------

interface LinkRequest {
  id: string;
  telegramId: string;
  telegramUsername: string | null;
  telegramName: string | null;
  code: string;
  createdAt: string;
}

interface WorkerRow {
  id: string;
  name: string;
  email: string;
  role: string;
  telegramId: string | null;
  telegramUsername: string | null;
}

function WorkersTab() {
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [requests, setRequests] = useState<LinkRequest[]>([]);
  const [roleChoice, setRoleChoice] = useState<Record<string, string>>({});
  const [target, setTarget] = useState<Record<string, string>>({});
  const [newWorker, setNewWorker] = useState<Record<string, { name: string; email: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/warehouse-workers");
      if (!res.ok) return;
      const d = await res.json();
      setWorkers(d.workers || []);
      setRequests(d.requests || []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const approve = async (req: LinkRequest) => {
    const role = roleChoice[req.id] || "SALES";
    const choice = target[req.id];
    if (!choice) return;

    setBusy(req.id);
    try {
      const body: Record<string, unknown> = { requestId: req.id, role };
      if (choice === "NEW") {
        const nw = newWorker[req.id];
        if (!nw?.name || !nw?.email) {
          alert("Вкажіть ім'я та email");
          return;
        }
        body.name = nw.name;
        body.email = nw.email;
      } else {
        body.userId = choice;
      }

      const res = await fetch("/api/admin/warehouse-workers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error || "Помилка");
        return;
      }
      load();
    } finally {
      setBusy(null);
    }
  };

  const unlink = async (userId: string) => {
    if (!confirm("Відв'язати Telegram від цього працівника?")) return;
    setBusy(userId);
    try {
      await fetch(`/api/admin/warehouse-workers?userId=${userId}`, { method: "DELETE" });
      load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {requests.length > 0 && (
        <div style={{ ...CARD, padding: "16px", marginBottom: "16px" }}>
          <h3 style={{ fontSize: "14px", fontWeight: 700, marginBottom: "4px" }}>
            Запити на підключення
          </h3>
          <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "14px" }}>
            Працівник надіслав /start боту та отримав код. Звірте код, оберіть роль і підтвердьте.
          </p>

          {requests.map((req) => {
            const role = roleChoice[req.id] || "SALES";
            const candidates = workers.filter((w) => !w.telegramId && w.role === role);

            return (
              <div key={req.id} style={{ border: "1px solid #E5E7EB", borderRadius: "10px", padding: "12px", marginBottom: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "10px" }}>
                  <code style={{ background: "#FFF8E1", padding: "6px 12px", borderRadius: "8px", fontWeight: 700, fontSize: "16px", letterSpacing: "2px" }}>
                    {req.code}
                  </code>
                  <div style={{ fontSize: "13px" }}>
                    <strong>{req.telegramName || "Без імені"}</strong>
                    {req.telegramUsername && (
                      <span style={{ color: "#6B7280" }}> @{req.telegramUsername}</span>
                    )}
                  </div>
                </div>

                {/* Роль обирається ПЕРШОЮ — вона фільтрує список кандидатів */}
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    value={role}
                    onChange={(e) => {
                      setRoleChoice({ ...roleChoice, [req.id]: e.target.value });
                      setTarget({ ...target, [req.id]: "" });
                    }}
                    style={{ padding: "7px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px", fontWeight: 600 }}
                  >
                    <option value="SALES">Торговий</option>
                    <option value="WAREHOUSE">Складовщик</option>
                  </select>

                  <select
                    value={target[req.id] || ""}
                    onChange={(e) => setTarget({ ...target, [req.id]: e.target.value })}
                    style={{ padding: "7px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px", minWidth: "200px" }}
                  >
                    <option value="">— оберіть працівника —</option>
                    {candidates.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.email})
                      </option>
                    ))}
                    <option value="NEW">+ Створити нового</option>
                  </select>

                  <button
                    onClick={() => approve(req)}
                    disabled={!target[req.id] || busy === req.id}
                    style={{
                      padding: "7px 16px",
                      borderRadius: "8px",
                      border: "none",
                      fontSize: "13px",
                      fontWeight: 600,
                      cursor: target[req.id] ? "pointer" : "not-allowed",
                      background: target[req.id] ? "#FFD600" : "#F3F4F6",
                      color: target[req.id] ? "#0A0A0A" : "#9CA3AF",
                    }}
                  >
                    {busy === req.id ? "..." : "Підтвердити"}
                  </button>
                </div>

                {target[req.id] === "NEW" && (
                  <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                    <input
                      placeholder="Ім'я"
                      value={newWorker[req.id]?.name || ""}
                      onChange={(e) =>
                        setNewWorker({
                          ...newWorker,
                          [req.id]: { ...(newWorker[req.id] || { name: "", email: "" }), name: e.target.value },
                        })
                      }
                      style={{ padding: "7px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px" }}
                    />
                    <input
                      placeholder="Email"
                      value={newWorker[req.id]?.email || ""}
                      onChange={(e) =>
                        setNewWorker({
                          ...newWorker,
                          [req.id]: { ...(newWorker[req.id] || { name: "", email: "" }), email: e.target.value },
                        })
                      }
                      style={{ padding: "7px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px" }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ ...CARD, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #F3F4F6" }}>
          <h3 style={{ fontSize: "14px", fontWeight: 700 }}>Працівники бота</h3>
        </div>
        {workers.length === 0 && (
          <div style={{ padding: "32px", textAlign: "center", color: "#6B7280", fontSize: "14px" }}>
            Поки що немає підключених працівників
          </div>
        )}
        {workers.map((w, i) => (
          <div
            key={w.id}
            style={{
              padding: "12px 16px",
              borderTop: i ? "1px solid #F3F4F6" : "none",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: "180px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600 }}>
                {w.name}
                {w.telegramUsername && (
                  <span style={{ color: "#6B7280", fontWeight: 400 }}> @{w.telegramUsername}</span>
                )}
              </div>
              <div style={{ fontSize: "12px", color: "#6B7280" }}>{w.email}</div>
            </div>

            <span
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "6px",
                fontWeight: 600,
                background: w.role === "SALES" ? "#EFF6FF" : "#FFF7ED",
                color: w.role === "SALES" ? "#2563EB" : "#C2410C",
              }}
            >
              {w.role === "SALES" ? "Торговий" : "Складовщик"}
            </span>

            <span
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "6px",
                fontWeight: 600,
                background: w.telegramId ? "#F0FDF4" : "#FEF3C7",
                color: w.telegramId ? "#16A34A" : "#D97706",
              }}
            >
              {w.telegramId ? "Telegram підключено" : "Не підключено"}
            </span>

            {w.telegramId && (
              <button
                onClick={() => unlink(w.id)}
                disabled={busy === w.id}
                style={{
                  padding: "5px 12px",
                  borderRadius: "8px",
                  border: "1px solid #FECACA",
                  background: "white",
                  color: "#DC2626",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {busy === w.id ? "..." : "Відв'язати"}
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
