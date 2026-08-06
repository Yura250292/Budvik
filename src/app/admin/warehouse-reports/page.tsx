"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { formatPrice } from "@/lib/utils";
import DynamicShiftMap from "@/components/map/DynamicShiftMap";
import type { ShiftPoint } from "@/components/map/ShiftMap";

type PeriodPreset = "today" | "week" | "month" | "quarter" | "year" | "all";
type Tab = "overview" | "productivity" | "workers" | "reports" | "nomenclature" | "shifts";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "В черзі",
  PROCESSING: "Обробляється",
  DONE: "Розпізнано",
  FAILED: "Помилка",
};

const STATUS_BG: Record<string, string> = {
  PENDING: "#FEF3C7",
  PROCESSING: "#EFF6FF",
  DONE: "#F0FDF4",
  FAILED: "#FEF2F2",
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: "#D97706",
  PROCESSING: "#2563EB",
  DONE: "#16A34A",
  FAILED: "#DC2626",
};

const DOC_TYPE_LABELS: Record<string, string> = {
  purchase: "Прихідна",
  sales: "Видаткова",
};

/**
 * Дата YYYY-MM-DD за КИЇВСЬКИМ часом.
 *
 * toISOString() дає UTC-дату: о 00:25 за Києвом він поверне ще вчорашнє
 * число, і накладна, здана вночі, випадала б з фільтра «Сьогодні»/«Місяць».
 */
function kyivDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function getDateRange(preset: PeriodPreset): { from: string; to: string } {
  const now = new Date();
  const to = kyivDateStr(now);
  let from = "";

  switch (preset) {
    case "today":
      from = to;
      break;
    case "week": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      from = kyivDateStr(d);
      break;
    }
    case "month": {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      from = kyivDateStr(d);
      break;
    }
    case "quarter": {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 3);
      from = kyivDateStr(d);
      break;
    }
    case "year":
      from = `${Number(kyivDateStr(now).slice(0, 4))}-01-01`;
      break;
    default:
      from = "";
  }

  return { from, to };
}

/** Ціни позицій — з копійками. formatPrice округлює до цілих ₴. */
function formatPrice2(value: number): string {
  return new Intl.NumberFormat("uk-UA", {
    style: "currency",
    currency: "UAH",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m} хв`;
  return `${h} год ${m} хв`;
}

function formatDateTime(value: string | Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatTime(value: string | Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateOnly(value: string | Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

const CARD: React.CSSProperties = {
  background: "white",
  borderRadius: "var(--radius-card, 12px)",
  border: "1px solid #E5E7EB",
};

/**
 * Клітинка геолокації: адреса + посилання на Google Maps із точними
 * координатами, щоб адмін міг перевірити, де саме був складовщик.
 */
function GeoCell({
  address,
  lat,
  lng,
}: {
  address: string | null;
  lat: number | null;
  lng: number | null;
}) {
  if (!address && lat == null) return <span>—</span>;

  return (
    <div>
      <div>{address || "Адресу не визначено"}</div>
      {lat != null && lng != null && (
        <a
          href={`https://www.google.com/maps?q=${lat},${lng}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ fontSize: "11px", color: "#2563EB", fontFamily: "monospace" }}
        >
          {lat.toFixed(5)}, {lng.toFixed(5)} ↗
        </a>
      )}
    </div>
  );
}

export default function WarehouseReportsPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState<PeriodPreset>("month");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [workerFilter, setWorkerFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [docTypeFilter, setDocTypeFilter] = useState("ALL");
  const [searchReport, setSearchReport] = useState("");
  const [searchNom, setSearchNom] = useState("");

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedReport, setExpandedReport] = useState<string | null>(null);
  const [reportDetails, setReportDetails] = useState<Record<string, any>>({});
  const [lightbox, setLightbox] = useState<string | null>(null);

  // Складовщики та запити на прив'язку
  const [workersData, setWorkersData] = useState<any>(null);
  const [linkTarget, setLinkTarget] = useState<Record<string, string>>({});
  const [newWorker, setNewWorker] = useState<Record<string, { name: string; email: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    const range = period !== "all" ? getDateRange(period) : { from: fromDate, to: toDate };
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    if (workerFilter !== "ALL") params.set("workerId", workerFilter);
    if (statusFilter !== "ALL") params.set("status", statusFilter);

    try {
      const res = await fetch(`/api/admin/warehouse-reports?${params}`);
      const json = await res.json();
      setData(res.ok ? json : null);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [period, fromDate, toDate, workerFilter, statusFilter]);

  const fetchWorkers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/warehouse-workers");
      if (res.ok) setWorkersData(await res.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (["ADMIN", "MANAGER"].includes(role)) fetchData();
  }, [role, fetchData]);

  useEffect(() => {
    if (["ADMIN", "MANAGER"].includes(role)) fetchWorkers();
  }, [role, fetchWorkers]);

  const loadDetails = async (id: string) => {
    if (reportDetails[id]) return;
    const res = await fetch(`/api/admin/warehouse-reports/${id}`);
    if (res.ok) {
      const json = await res.json();
      setReportDetails((prev) => ({ ...prev, [id]: json }));
    }
  };

  const toggleReport = (id: string) => {
    if (expandedReport === id) {
      setExpandedReport(null);
      return;
    }
    setExpandedReport(id);
    loadDetails(id);
  };

  const retryReport = async (id: string) => {
    setBusy(id);
    const res = await fetch(`/api/admin/warehouse-reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "retry" }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "Помилка");
    } else {
      setReportDetails((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await fetchData();
    }
    setBusy(null);
  };

  const deleteReport = async (r: any) => {
    const label = r.docNumber ? `№${r.docNumber}` : "без номера";
    if (
      !confirm(
        `Видалити накладну ${label} (${r.userName})?\n\n` +
          "Фото та всі позиції буде видалено назавжди. Дію не можна скасувати."
      )
    )
      return;

    setBusy(r.id);
    const res = await fetch(`/api/admin/warehouse-reports/${r.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error || "Помилка видалення");
    } else {
      if (expandedReport === r.id) setExpandedReport(null);
      await fetchData();
    }
    setBusy(null);
  };

  const approveRequest = async (requestId: string) => {
    const userId = linkTarget[requestId];
    const draft = newWorker[requestId];

    const body: any = { requestId };
    if (userId && userId !== "NEW") {
      body.userId = userId;
    } else {
      if (!draft?.name || !draft?.email) {
        alert("Вкажіть ім'я та email нового складовщика");
        return;
      }
      body.name = draft.name;
      body.email = draft.email;
    }

    setBusy(requestId);
    const res = await fetch("/api/admin/warehouse-workers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) alert(json.error || "Помилка");
    else {
      await fetchWorkers();
      await fetchData();
    }
    setBusy(null);
  };

  const unlinkWorker = async (userId: string, name: string) => {
    if (!confirm(`Відв'язати Telegram від ${name}?`)) return;
    setBusy(userId);
    const res = await fetch(`/api/admin/warehouse-workers?userId=${userId}`, {
      method: "DELETE",
    });
    if (!res.ok) alert("Помилка");
    else await fetchWorkers();
    setBusy(null);
  };

  /**
   * Точки для карти: по дві на зміну (відкриття + закриття).
   * useMemo стоїть ДО раннього return, інакше порушується порядок хуків.
   */
  const shiftPoints: ShiftPoint[] = useMemo(() => {
    const list: ShiftPoint[] = [];
    for (const s of data?.shifts || []) {
      if (s.openLat != null && s.openLng != null) {
        list.push({
          lat: s.openLat,
          lng: s.openLng,
          type: "open",
          workerName: s.userName,
          time: formatDateTime(s.openedAt),
          address: s.openAddress,
          shiftId: s.id,
        });
      }
      if (s.closeLat != null && s.closeLng != null) {
        list.push({
          lat: s.closeLat,
          lng: s.closeLng,
          type: "close",
          workerName: s.userName,
          time: formatDateTime(s.closedAt),
          address: s.closeAddress,
          shiftId: s.id,
        });
      }
    }
    return list;
  }, [data]);

  if (!["ADMIN", "MANAGER"].includes(role)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-lg font-bold">Доступ заборонено</p>
      </div>
    );
  }

  const kpis = data?.kpis;
  const workers = data?.workers || [];
  // Тип документа й пошук фільтруються на клієнті — дані вже завантажені,
  // тож зайвий запит на сервер не потрібен
  const reports = (data?.reports || []).filter((r: any) => {
    if (docTypeFilter !== "ALL" && r.docType !== docTypeFilter) return false;
    if (!searchReport) return true;
    const q = searchReport.toLowerCase();
    return (
      r.docNumber?.toLowerCase().includes(q) ||
      r.counterpartyName?.toLowerCase().includes(q) ||
      r.userName?.toLowerCase().includes(q)
    );
  });
  const reportsSum = reports
    .filter((r: any) => r.status === "DONE")
    .reduce((s: number, r: any) => s + (r.totalAmount || 0), 0);
  const shifts = data?.shifts || [];
  const nomenclature = (data?.nomenclature || []).filter(
    (n: any) =>
      !searchNom ||
      n.name?.toLowerCase().includes(searchNom.toLowerCase()) ||
      n.sku?.toLowerCase().includes(searchNom.toLowerCase())
  );
  const maxWorkerAmount = Math.max(1, ...workers.map((w: any) => w.totalAmount || 0));
  const maxItems = Math.max(1, ...workers.map((w: any) => w.itemsCount || 0));
  const hourly = data?.hourly || [];
  const maxHourly = Math.max(1, ...hourly.map((h: any) => h.reports || 0));
  const teamAvg = data?.teamAvg || { itemsPerHour: 0, itemsPerDay: 0, reportsPerDay: 0 };

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF" }}>
        <div className="max-w-7xl mx-auto" style={{ padding: "14px 24px" }}>
          <div className="flex items-center gap-3 mb-3">
            <Link
              href="/admin"
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "#FFD600" }}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#0A0A0A" }}>Звіти з складу</h1>
              <p style={{ fontSize: "13px", color: "#6B7280" }}>
                Зміни та накладні складовщиків
              </p>
            </div>
          </div>

          <div
            className="flex gap-1 overflow-x-auto"
            style={{ background: "#F3F4F6", borderRadius: "10px", padding: "3px" }}
          >
            {(
              [
                ["overview", "Огляд"],
                ["productivity", "Продуктивність"],
                ["workers", "Складовщики"],
                ["reports", "Накладні"],
                ["nomenclature", "Номенклатура"],
                ["shifts", "Зміни"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  fontSize: "14px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  background: activeTab === key ? "white" : "transparent",
                  color: activeTab === key ? "#0A0A0A" : "#6B7280",
                  boxShadow: activeTab === key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div
        className="max-w-7xl mx-auto px-4 sm:px-6"
        style={{ paddingTop: "16px", paddingBottom: "40px" }}
      >
        {/* Фільтри */}
        <div className="flex flex-wrap gap-3 mb-5 items-end">
          <div
            className="flex gap-1"
            style={{ background: "#fff", borderRadius: "8px", padding: "2px", border: "1px solid #E5E7EB" }}
          >
            {(
              [
                ["today", "Сьогодні"],
                ["week", "Тиждень"],
                ["month", "Місяць"],
                ["quarter", "Квартал"],
                ["year", "Рік"],
                ["all", "Все"],
              ] as [PeriodPreset, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPeriod(key)}
                style={{
                  padding: "6px 12px",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 500,
                  background: period === key ? "#0A0A0A" : "transparent",
                  color: period === key ? "white" : "#6B7280",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {period === "all" && (
            <>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px" }}
              />
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px" }}
              />
              <button
                onClick={fetchData}
                style={{ padding: "6px 14px", borderRadius: "8px", fontWeight: 600, fontSize: "13px", background: "#FFD600" }}
              >
                Застосувати
              </button>
            </>
          )}

          <select
            value={workerFilter}
            onChange={(e) => setWorkerFilter(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px", background: "white" }}
          >
            <option value="ALL">Усі складовщики</option>
            {(data?.workersList || []).map((w: any) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>

          {activeTab === "reports" && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px", background: "white" }}
            >
              <option value="ALL">Усі статуси</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          )}

          {activeTab === "reports" && (
            <>
              <select
                value={docTypeFilter}
                onChange={(e) => setDocTypeFilter(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px", background: "white" }}
              >
                <option value="ALL">Усі типи</option>
                <option value="purchase">Прихідні</option>
                <option value="sales">Видаткові</option>
              </select>

              <input
                placeholder="Пошук: № або контрагент..."
                value={searchReport}
                onChange={(e) => setSearchReport(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: "8px",
                  border: "1px solid #E5E7EB",
                  fontSize: "13px",
                  minWidth: "220px",
                }}
              />
            </>
          )}
        </div>

        {loading && <p style={{ color: "#6B7280", fontSize: "14px" }}>Завантаження...</p>}

        {!loading && !data && (
          <div style={{ ...CARD, padding: "24px", textAlign: "center", color: "#6B7280" }}>
            Не вдалося завантажити дані
          </div>
        )}

        {!loading && data && (
          <>
            {/* ---------- ОГЛЯД ---------- */}
            {activeTab === "overview" && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
                  {[
                    { label: "Накладних", value: kpis.totalReports },
                    { label: "Сума", value: formatPrice(kpis.totalAmount) },
                    { label: "Позицій", value: kpis.totalItems },
                    { label: "Складовщиків", value: kpis.activeWorkers },
                    { label: "Змін", value: kpis.totalShifts },
                    { label: "Годин", value: formatHours(kpis.totalHours) },
                  ].map((k) => (
                    <div key={k.label} style={{ ...CARD, padding: "14px 16px" }}>
                      <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "4px" }}>{k.label}</p>
                      <p style={{ fontSize: "20px", fontWeight: 700, color: "#0A0A0A" }}>{k.value}</p>
                    </div>
                  ))}
                </div>

                {(kpis.pending > 0 || kpis.failed > 0) && (
                  <div className="flex flex-wrap gap-3 mb-5">
                    {kpis.pending > 0 && (
                      <div
                        style={{
                          ...CARD,
                          padding: "10px 14px",
                          background: STATUS_BG.PENDING,
                          borderColor: STATUS_COLOR.PENDING,
                          color: STATUS_COLOR.PENDING,
                          fontSize: "13px",
                          fontWeight: 600,
                        }}
                      >
                        ⏳ Обробляється: {kpis.pending}
                      </div>
                    )}
                    {kpis.failed > 0 && (
                      <div
                        style={{
                          ...CARD,
                          padding: "10px 14px",
                          background: STATUS_BG.FAILED,
                          borderColor: STATUS_COLOR.FAILED,
                          color: STATUS_COLOR.FAILED,
                          fontSize: "13px",
                          fontWeight: 600,
                        }}
                      >
                        ❌ Помилки розпізнавання: {kpis.failed}
                      </div>
                    )}
                  </div>
                )}

                <div style={{ ...CARD, padding: "16px" }}>
                  <h2 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>
                    Складовщики
                  </h2>
                  {workers.length === 0 && (
                    <p style={{ color: "#6B7280", fontSize: "14px" }}>Немає активності за період</p>
                  )}
                  {workers.map((w: any) => (
                    <button
                      key={w.id}
                      onClick={() => {
                        setWorkerFilter(w.id);
                        setActiveTab("reports");
                      }}
                      className="w-full text-left"
                      style={{ padding: "10px 0", borderBottom: "1px solid #F3F4F6" }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          {w.openShift && (
                            <span
                              style={{
                                width: "8px",
                                height: "8px",
                                borderRadius: "50%",
                                background: "#16A34A",
                                display: "inline-block",
                              }}
                              title={`На зміні з ${formatTime(w.openShift.openedAt)}`}
                            />
                          )}
                          <span style={{ fontWeight: 600, fontSize: "14px" }}>{w.name}</span>
                          <span style={{ fontSize: "12px", color: "#6B7280" }}>
                            {w.shiftsCount} змін · {formatHours(w.totalHours)} · {w.reportsCount} накладних
                          </span>
                        </div>
                        <span style={{ fontWeight: 700, fontSize: "14px" }}>
                          {formatPrice(w.totalAmount)}
                        </span>
                      </div>
                      <div style={{ height: "6px", background: "#F3F4F6", borderRadius: "3px" }}>
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.round((w.totalAmount / maxWorkerAmount) * 100)}%`,
                            background: "#FFD600",
                            borderRadius: "3px",
                          }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ---------- ПРОДУКТИВНІСТЬ ---------- */}
            {activeTab === "productivity" && (
              <>
                <div style={{ ...CARD, padding: "14px 16px", marginBottom: "16px", background: "#F0F9FF", borderColor: "#BAE6FD" }}>
                  <p style={{ fontSize: "13px", color: "#075985" }}>
                    <b>Як рахується:</b> продуктивність міряється <b>позиціями товару</b>, а не
                    кількістю накладних — накладна на 2 рядки і на 40 це різний обсяг роботи.
                    Швидкість рахується на <b>тривалість зміни</b>, а не на активні години —
                    інакше той, хто здав усе залпом за 20 хвилин, виглядав би найшвидшим.
                    <b> Рівномірність</b> показує, яку частку зміни людина справді працювала.
                  </p>
                </div>

                {workers.length === 0 ? (
                  <div style={{ ...CARD, padding: "24px", textAlign: "center", color: "#6B7280" }}>
                    Немає даних за обраний період
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                      {[
                        { label: "Позицій за годину", value: teamAvg.itemsPerHour, sub: "у середньому по складу" },
                        { label: "Позицій за день", value: teamAvg.itemsPerDay, sub: "на одного складовщика" },
                        { label: "Накладних за день", value: teamAvg.reportsPerDay, sub: "на одного складовщика" },
                        { label: "Активних складовщиків", value: workers.filter((w: any) => w.doneCount > 0).length, sub: "за період" },
                      ].map((k) => (
                        <div key={k.label} style={{ ...CARD, padding: "14px 16px" }}>
                          <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "4px" }}>{k.label}</p>
                          <p style={{ fontSize: "22px", fontWeight: 700, color: "#0A0A0A" }}>{k.value}</p>
                          <p style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "2px" }}>{k.sub}</p>
                        </div>
                      ))}
                    </div>

                    {/* Рейтинг за обсягом опрацьованих позицій */}
                    <div style={{ ...CARD, padding: "16px", marginBottom: "16px" }}>
                      <h2 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}>
                        Рейтинг за обсягом роботи
                      </h2>
                      <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "14px" }}>
                        Скільки позицій товару опрацював кожен складовщик
                      </p>

                      {workers.map((w: any, i: number) => {
                        const pct = Math.round((w.itemsCount / maxItems) * 100);
                        const vsTeam = teamAvg.itemsPerHour
                          ? Math.round((w.itemsPerHour / teamAvg.itemsPerHour - 1) * 100)
                          : 0;
                        return (
                          <div key={w.id} style={{ padding: "12px 0", borderTop: i === 0 ? "none" : "1px solid #F3F4F6" }}>
                            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                              <div className="flex items-center gap-2">
                                <span style={{ fontSize: "13px", color: "#9CA3AF", width: "18px" }}>{i + 1}.</span>
                                {w.openShift && (
                                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#16A34A", display: "inline-block" }} title="Зараз на зміні" />
                                )}
                                <span style={{ fontWeight: 600, fontSize: "14px" }}>{w.name}</span>
                                {w.doneCount > 0 && (
                                  <span
                                    style={{
                                      fontSize: "11px",
                                      padding: "2px 7px",
                                      borderRadius: "5px",
                                      fontWeight: 600,
                                      background: vsTeam >= 0 ? "#F0FDF4" : "#FEF3C7",
                                      color: vsTeam >= 0 ? "#16A34A" : "#D97706",
                                    }}
                                    title="Порівняно із середнім по складу"
                                  >
                                    {vsTeam >= 0 ? "+" : ""}{vsTeam}% до середнього
                                  </span>
                                )}
                              </div>
                              <span style={{ fontSize: "14px", fontWeight: 700 }}>
                                {w.itemsCount} позицій
                              </span>
                            </div>

                            <div style={{ height: "8px", background: "#F3F4F6", borderRadius: "4px", marginBottom: "8px" }}>
                              <div style={{ height: "100%", width: `${pct}%`, background: "#FFD600", borderRadius: "4px" }} />
                            </div>

                            <div className="flex flex-wrap gap-x-5 gap-y-1" style={{ fontSize: "12px", color: "#6B7280" }}>
                              <span>⚡️ <b style={{ color: "#0A0A0A" }}>{w.itemsPerHour}</b> позицій/год</span>
                              <span>📄 {w.doneCount} накладних (по {w.avgItemsPerReport} позицій)</span>
                              <span>⏱ {formatHours(w.activeHours)} активних</span>
                              <span>📅 {w.daysWorked} {w.daysWorked === 1 ? "день" : "днів"}</span>
                              {w.avgGapMinutes != null && <span>⏳ пауза ~{w.avgGapMinutes} хв</span>}
                              {w.evenness != null && (
                                <span
                                  title="Яку частку зміни людина реально працювала. 100% — рівномірно весь день, низький % — здав усе одним залпом"
                                  style={{ color: w.evenness < 30 ? "#D97706" : undefined }}
                                >
                                  📊 рівномірність {w.evenness}%
                                </span>
                              )}
                              {w.failRate > 0 && (
                                <span style={{ color: "#DC2626" }}>❌ {w.failRate}% фото не розпізнано</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Навантаження по годинах доби */}
                    <div style={{ ...CARD, padding: "16px" }}>
                      <h2 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}>
                        Навантаження по годинах
                      </h2>
                      <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "14px" }}>
                        Коли складовщики здають накладні (київський час)
                      </p>

                      <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", height: "120px" }}>
                        {hourly.map((h: any) => {
                          const pct = maxHourly ? (h.reports / maxHourly) * 100 : 0;
                          return (
                            <div
                              key={h.hour}
                              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}
                              title={`${String(h.hour).padStart(2, "0")}:00 — ${h.reports} накладних`}
                            >
                              <div style={{ fontSize: "10px", color: "#9CA3AF", height: "12px" }}>
                                {h.reports || ""}
                              </div>
                              <div
                                style={{
                                  width: "100%",
                                  height: `${Math.max(pct, h.reports ? 4 : 0)}%`,
                                  minHeight: h.reports ? "3px" : "0",
                                  background: h.reports ? "#FFD600" : "transparent",
                                  borderRadius: "3px 3px 0 0",
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: "flex", gap: "3px", marginTop: "4px" }}>
                        {hourly.map((h: any) => (
                          <div key={h.hour} style={{ flex: 1, textAlign: "center", fontSize: "9px", color: "#9CA3AF" }}>
                            {h.hour % 3 === 0 ? String(h.hour).padStart(2, "0") : ""}
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}


            {/* ---------- СКЛАДОВЩИКИ ---------- */}
            {activeTab === "workers" && (
              <>
                {workersData?.requests?.length > 0 && (
                  <div style={{ ...CARD, padding: "16px", marginBottom: "16px" }}>
                    <h2 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}>
                      Запити на підключення
                    </h2>
                    <p style={{ fontSize: "13px", color: "#6B7280", marginBottom: "12px" }}>
                      Складовщик надіслав /start боту та отримав код. Звіріть код і підтвердьте.
                    </p>
                    {workersData.requests.map((r: any) => (
                      <div
                        key={r.id}
                        style={{ padding: "12px 0", borderTop: "1px solid #F3F4F6" }}
                      >
                        <div className="flex flex-wrap items-center gap-3 mb-2">
                          <span
                            style={{
                              fontFamily: "monospace",
                              fontSize: "18px",
                              fontWeight: 700,
                              background: "#FFF8E1",
                              padding: "4px 10px",
                              borderRadius: "6px",
                            }}
                          >
                            {r.code}
                          </span>
                          <span style={{ fontWeight: 600, fontSize: "14px" }}>
                            {r.telegramName || "Без імені"}
                          </span>
                          {r.telegramUsername && (
                            <span style={{ fontSize: "13px", color: "#6B7280" }}>
                              @{r.telegramUsername}
                            </span>
                          )}
                          <span style={{ fontSize: "12px", color: "#9CA3AF" }}>
                            {formatDateTime(r.createdAt)}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-2 items-center">
                          <select
                            value={linkTarget[r.id] || ""}
                            onChange={(e) =>
                              setLinkTarget((p) => ({ ...p, [r.id]: e.target.value }))
                            }
                            style={{
                              padding: "6px 10px",
                              borderRadius: "8px",
                              border: "1px solid #E5E7EB",
                              fontSize: "13px",
                              background: "white",
                            }}
                          >
                            <option value="">— Оберіть складовщика —</option>
                            {(workersData.workers || [])
                              .filter((w: any) => !w.telegramId)
                              .map((w: any) => (
                                <option key={w.id} value={w.id}>
                                  {w.name} ({w.email})
                                </option>
                              ))}
                            <option value="NEW">+ Створити нового</option>
                          </select>

                          {linkTarget[r.id] === "NEW" && (
                            <>
                              <input
                                placeholder="Ім'я"
                                value={newWorker[r.id]?.name || ""}
                                onChange={(e) =>
                                  setNewWorker((p) => ({
                                    ...p,
                                    [r.id]: { ...(p[r.id] || { name: "", email: "" }), name: e.target.value },
                                  }))
                                }
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: "8px",
                                  border: "1px solid #E5E7EB",
                                  fontSize: "13px",
                                }}
                              />
                              <input
                                placeholder="Email"
                                value={newWorker[r.id]?.email || ""}
                                onChange={(e) =>
                                  setNewWorker((p) => ({
                                    ...p,
                                    [r.id]: { ...(p[r.id] || { name: "", email: "" }), email: e.target.value },
                                  }))
                                }
                                style={{
                                  padding: "6px 10px",
                                  borderRadius: "8px",
                                  border: "1px solid #E5E7EB",
                                  fontSize: "13px",
                                }}
                              />
                            </>
                          )}

                          <button
                            onClick={() => approveRequest(r.id)}
                            disabled={busy === r.id || !linkTarget[r.id]}
                            style={{
                              padding: "6px 14px",
                              borderRadius: "8px",
                              fontWeight: 600,
                              fontSize: "13px",
                              background: linkTarget[r.id] ? "#FFD600" : "#F3F4F6",
                              color: linkTarget[r.id] ? "#0A0A0A" : "#9CA3AF",
                            }}
                          >
                            {busy === r.id ? "..." : "Підтвердити"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ ...CARD, padding: "16px" }}>
                  <h2 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>
                    Складовщики ({workersData?.workers?.length || 0})
                  </h2>
                  {(workersData?.workers || []).length === 0 && (
                    <p style={{ color: "#6B7280", fontSize: "14px" }}>
                      Немає складовщиків. Створіть користувача з роллю «Складовщик» або підтвердьте
                      запит із бота.
                    </p>
                  )}
                  {(workersData?.workers || []).map((w: any) => {
                    const agg = workers.find((x: any) => x.id === w.id);
                    return (
                      <div
                        key={w.id}
                        style={{ padding: "12px 0", borderTop: "1px solid #F3F4F6" }}
                        className="flex flex-wrap items-center justify-between gap-2"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            {agg?.openShift && (
                              <span
                                style={{
                                  width: "8px",
                                  height: "8px",
                                  borderRadius: "50%",
                                  background: "#16A34A",
                                  display: "inline-block",
                                }}
                              />
                            )}
                            <span style={{ fontWeight: 600, fontSize: "14px" }}>{w.name}</span>
                            {w.telegramUsername && (
                              <span style={{ fontSize: "13px", color: "#6B7280" }}>
                                @{w.telegramUsername}
                              </span>
                            )}
                          </div>
                          <p style={{ fontSize: "12px", color: "#6B7280", marginTop: "2px" }}>
                            {w.email}
                            {agg
                              ? ` · ${agg.shiftsCount} змін · ${agg.reportsCount} накладних · ${formatPrice(agg.totalAmount)}`
                              : " · немає активності за період"}
                          </p>
                          {agg?.openShift && (
                            <p style={{ fontSize: "12px", color: "#16A34A", marginTop: "2px" }}>
                              На зміні з {formatTime(agg.openShift.openedAt)}
                              {agg.openShift.openAddress ? ` · ${agg.openShift.openAddress}` : ""}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            style={{
                              fontSize: "12px",
                              padding: "3px 8px",
                              borderRadius: "6px",
                              background: w.telegramId ? "#F0FDF4" : "#FEF3C7",
                              color: w.telegramId ? "#16A34A" : "#D97706",
                              fontWeight: 600,
                            }}
                          >
                            {w.telegramId ? "Telegram підключено" : "Не підключено"}
                          </span>
                          {w.telegramId && (
                            <button
                              onClick={() => unlinkWorker(w.id, w.name)}
                              disabled={busy === w.id}
                              style={{ fontSize: "12px", color: "#DC2626", fontWeight: 600 }}
                            >
                              Відв'язати
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ---------- НАКЛАДНІ ---------- */}
            {activeTab === "reports" && (
              <div style={{ ...CARD, overflow: "hidden" }}>
                <div
                  style={{
                    padding: "12px 16px",
                    borderBottom: "1px solid #F3F4F6",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "16px",
                    alignItems: "baseline",
                  }}
                >
                  <span style={{ fontSize: "14px", fontWeight: 700 }}>
                    Знайдено: {reports.length}
                  </span>
                  {reportsSum > 0 && (
                    <span style={{ fontSize: "14px", color: "#6B7280" }}>
                      Сума розпізнаних: <b style={{ color: "#0A0A0A" }}>{formatPrice(reportsSum)}</b>
                    </span>
                  )}
                  <span style={{ fontSize: "12px", color: "#9CA3AF", marginLeft: "auto" }}>
                    Клік по рядку — швидкий перегляд, «Відкрити» — повна накладна
                  </span>
                </div>

                {reports.length === 0 && (
                  <p style={{ padding: "20px", color: "#6B7280", fontSize: "14px" }}>
                    Немає накладних за обраними фільтрами
                  </p>
                )}
                {reports.length > 0 && (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#FAFAFA", textAlign: "left" }}>
                          {["Дата", "Складовщик", "Тип", "№", "Дата док.", "Контрагент", "Позицій", "Сума", "Статус", ""].map(
                            (h) => (
                              <th
                                key={h}
                                style={{ padding: "10px 12px", fontWeight: 600, color: "#6B7280", whiteSpace: "nowrap" }}
                              >
                                {h}
                              </th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {reports.map((r: any) => (
                          <Fragment key={r.id}>
                            <tr
                              onClick={() => toggleReport(r.id)}
                              style={{ borderTop: "1px solid #F3F4F6", cursor: "pointer" }}
                            >
                              <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                                {formatDateTime(r.createdAt)}
                              </td>
                              <td style={{ padding: "10px 12px", fontWeight: 600 }}>{r.userName}</td>
                              <td style={{ padding: "10px 12px" }}>
                                {r.docType ? DOC_TYPE_LABELS[r.docType] || r.docType : "—"}
                              </td>
                              <td style={{ padding: "10px 12px" }}>{r.docNumber || "—"}</td>
                              <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                                {formatDateOnly(r.docDate)}
                              </td>
                              <td style={{ padding: "10px 12px" }}>{r.counterpartyName || "—"}</td>
                              <td style={{ padding: "10px 12px" }}>{r.itemsCount}</td>
                              <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                                {r.totalAmount ? formatPrice(r.totalAmount) : "—"}
                              </td>
                              <td style={{ padding: "10px 12px" }}>
                                <span
                                  style={{
                                    fontSize: "12px",
                                    padding: "3px 8px",
                                    borderRadius: "6px",
                                    background: STATUS_BG[r.status],
                                    color: STATUS_COLOR[r.status],
                                    fontWeight: 600,
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {STATUS_LABELS[r.status]}
                                </span>
                              </td>
                              <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                                <div className="flex items-center gap-3">
                                  <Link
                                    href={`/admin/warehouse-reports/${r.id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    style={{ fontSize: "12px", color: "#2563EB", fontWeight: 600 }}
                                  >
                                    Відкрити ↗
                                  </Link>
                                  {role === "ADMIN" && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteReport(r);
                                      }}
                                      disabled={busy === r.id}
                                      title="Видалити накладну"
                                      style={{ fontSize: "12px", color: "#DC2626", fontWeight: 600 }}
                                    >
                                      {busy === r.id ? "..." : "Видалити"}
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>

                            {expandedReport === r.id && (
                              <tr>
                                <td colSpan={10} style={{ padding: "0 12px 16px", background: "#FAFAFA" }}>
                                  {r.errorMessage && (
                                    <p
                                      style={{
                                        color: STATUS_COLOR.FAILED,
                                        fontSize: "13px",
                                        padding: "10px 0",
                                      }}
                                    >
                                      ❌ {r.errorMessage}
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          retryReport(r.id);
                                        }}
                                        disabled={busy === r.id}
                                        style={{
                                          marginLeft: "10px",
                                          padding: "4px 12px",
                                          borderRadius: "6px",
                                          background: "#FFD600",
                                          color: "#0A0A0A",
                                          fontWeight: 600,
                                          fontSize: "12px",
                                        }}
                                      >
                                        {busy === r.id ? "..." : "Повторити"}
                                      </button>
                                    </p>
                                  )}

                                  <div className="flex flex-col lg:flex-row gap-4" style={{ paddingTop: "12px" }}>
                                    {r.photoUrl && (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={`/api/admin/warehouse-reports/${r.id}/photo`}
                                        alt="Накладна"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setLightbox(`/api/admin/warehouse-reports/${r.id}/photo`);
                                        }}
                                        style={{
                                          width: "180px",
                                          height: "auto",
                                          borderRadius: "8px",
                                          border: "1px solid #E5E7EB",
                                          cursor: "zoom-in",
                                          objectFit: "cover",
                                        }}
                                      />
                                    )}

                                    <div style={{ flex: 1, overflowX: "auto" }}>
                                      {!reportDetails[r.id] ? (
                                        <p style={{ fontSize: "13px", color: "#6B7280" }}>
                                          Завантаження...
                                        </p>
                                      ) : reportDetails[r.id].items?.length ? (
                                        <table
                                          style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}
                                        >
                                          <thead>
                                            <tr style={{ textAlign: "left" }}>
                                              {["Товар", "Артикул", "Од.", "Кількість", "Ціна", "Сума"].map((h) => (
                                                <th
                                                  key={h}
                                                  style={{
                                                    padding: "6px 8px",
                                                    fontWeight: 600,
                                                    color: "#6B7280",
                                                    whiteSpace: "nowrap",
                                                  }}
                                                >
                                                  {h}
                                                </th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {reportDetails[r.id].items.map((item: any) => (
                                              <tr key={item.id} style={{ borderTop: "1px solid #E5E7EB" }}>
                                                <td style={{ padding: "6px 8px" }}>
                                                  <div>{item.name}</div>
                                                  {item.matchedProductName &&
                                                    item.matchedProductName !== item.name && (
                                                      <div style={{ fontSize: "11px", color: "#9CA3AF" }}>
                                                        ↳ {item.matchedProductName}
                                                      </div>
                                                    )}
                                                </td>
                                                <td style={{ padding: "6px 8px", color: "#6B7280" }}>
                                                  {item.sku || "—"}
                                                </td>
                                                <td style={{ padding: "6px 8px", color: "#6B7280" }}>
                                                  {item.unit || "—"}
                                                </td>
                                                <td style={{ padding: "6px 8px" }}>{formatQty(item.quantity)}</td>
                                                <td style={{ padding: "6px 8px" }}>{formatPrice2(item.price)}</td>
                                                <td style={{ padding: "6px 8px", fontWeight: 600 }}>
                                                  {formatPrice2(item.lineTotal)}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                          <tfoot>
                                            <tr style={{ borderTop: "2px solid #D1D5DB", background: "#FAFAFA" }}>
                                              <td
                                                colSpan={5}
                                                style={{ padding: "8px", fontWeight: 700, textAlign: "right" }}
                                              >
                                                Разом:
                                              </td>
                                              <td style={{ padding: "8px", fontWeight: 700, whiteSpace: "nowrap" }}>
                                                {formatPrice2(
                                                  reportDetails[r.id].items.reduce(
                                                    (s: number, i: any) => s + (i.lineTotal || 0),
                                                    0
                                                  )
                                                )}
                                              </td>
                                            </tr>
                                            {(() => {
                                              // Сума з документа поруч із сумою позицій — одразу видно,
                                              // чи AI не пропустив рядок
                                              const itemsSum = reportDetails[r.id].items.reduce(
                                                (s: number, i: any) => s + (i.lineTotal || 0),
                                                0
                                              );
                                              const declared = reportDetails[r.id].totalAmount || 0;
                                              if (!declared) return null;
                                              const diff = Math.abs(declared - itemsSum) > 1;
                                              return (
                                                <tr style={{ background: diff ? "#FEF3C7" : "#FAFAFA" }}>
                                                  <td
                                                    colSpan={5}
                                                    style={{
                                                      padding: "8px",
                                                      textAlign: "right",
                                                      color: diff ? "#D97706" : "#6B7280",
                                                      fontWeight: diff ? 700 : 500,
                                                    }}
                                                  >
                                                    {diff ? "⚠️ У накладній вказано:" : "У накладній вказано:"}
                                                  </td>
                                                  <td
                                                    style={{
                                                      padding: "8px",
                                                      fontWeight: 700,
                                                      whiteSpace: "nowrap",
                                                      color: diff ? "#D97706" : "#6B7280",
                                                    }}
                                                  >
                                                    {formatPrice2(declared)}
                                                  </td>
                                                </tr>
                                              );
                                            })()}
                                          </tfoot>
                                        </table>
                                      ) : (
                                        <p style={{ fontSize: "13px", color: "#6B7280" }}>
                                          Позицій не розпізнано
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ---------- НОМЕНКЛАТУРА ---------- */}
            {activeTab === "nomenclature" && (
              <div style={{ ...CARD, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #F3F4F6" }}>
                  <input
                    placeholder="Пошук за назвою або артикулом..."
                    value={searchNom}
                    onChange={(e) => setSearchNom(e.target.value)}
                    style={{
                      width: "100%",
                      maxWidth: "360px",
                      padding: "8px 12px",
                      borderRadius: "8px",
                      border: "1px solid #E5E7EB",
                      fontSize: "13px",
                    }}
                  />
                </div>

                {nomenclature.length === 0 ? (
                  <p style={{ padding: "20px", color: "#6B7280", fontSize: "14px" }}>
                    Немає розпізнаних позицій за обраний період
                  </p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#FAFAFA", textAlign: "left" }}>
                          {["Товар", "Артикул", "Од.", "Кількість", "Сер. ціна", "Сума", "Накладних", "Складовщики"].map(
                            (h) => (
                              <th
                                key={h}
                                style={{ padding: "10px 12px", fontWeight: 600, color: "#6B7280", whiteSpace: "nowrap" }}
                              >
                                {h}
                              </th>
                            )
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {nomenclature.map((n: any, i: number) => (
                          <tr key={`${n.name}-${i}`} style={{ borderTop: "1px solid #F3F4F6" }}>
                            <td style={{ padding: "10px 12px" }}>
                              <div style={{ fontWeight: 600 }}>{n.name}</div>
                              {n.matchedProductName && n.matchedProductName !== n.name && (
                                <div style={{ fontSize: "12px", color: "#9CA3AF" }}>
                                  ↳ {n.matchedProductName}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: "10px 12px", color: "#6B7280" }}>{n.sku || "—"}</td>
                            <td style={{ padding: "10px 12px", color: "#6B7280" }}>{n.unit || "—"}</td>
                            <td style={{ padding: "10px 12px", fontWeight: 600 }}>{formatQty(n.quantity)}</td>
                            <td style={{ padding: "10px 12px" }}>{formatPrice2(n.avgPrice)}</td>
                            <td style={{ padding: "10px 12px", fontWeight: 700 }}>{formatPrice2(n.totalSum)}</td>
                            <td style={{ padding: "10px 12px", color: "#6B7280" }}>{n.reportsCount}</td>
                            <td style={{ padding: "10px 12px", color: "#6B7280", fontSize: "12px" }}>
                              {n.workers.join(", ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ---------- ЗМІНИ ---------- */}
            {activeTab === "shifts" && (
              <>
                {/* Карта: зелений пін — відкриття, червоний — закриття */}
                <div style={{ ...CARD, padding: "16px", marginBottom: "16px" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h2 style={{ fontSize: "16px", fontWeight: 700 }}>
                      Карта змін
                    </h2>
                    <div className="flex items-center gap-4" style={{ fontSize: "12px", color: "#6B7280" }}>
                      <span className="flex items-center gap-1.5">
                        <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#16A34A", display: "inline-block" }} />
                        Відкриття зміни
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#DC2626", display: "inline-block" }} />
                        Закриття зміни
                      </span>
                    </div>
                  </div>

                  {shiftPoints.length === 0 ? (
                    <div
                      style={{
                        height: "420px",
                        background: "#F9FAFB",
                        borderRadius: "12px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#9CA3AF",
                        fontSize: "14px",
                        textAlign: "center",
                        padding: "20px",
                      }}
                    >
                      Немає геолокації за обраний період.
                      <br />
                      Координати з&apos;являться, коли складовщик відкриє зміну в боті.
                    </div>
                  ) : (
                    <DynamicShiftMap points={shiftPoints} />
                  )}
                </div>

                <div style={{ ...CARD, overflow: "hidden" }}>
                  {shifts.length === 0 ? (
                    <p style={{ padding: "20px", color: "#6B7280", fontSize: "14px" }}>
                      Немає змін за обраний період
                    </p>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#FAFAFA", textAlign: "left" }}>
                            {[
                              "Дата",
                              "Складовщик",
                              "Відкрито",
                              "Закрито",
                              "Тривалість",
                              "Місце відкриття",
                              "Місце закриття",
                              "Накладних",
                              "Сума",
                            ].map((h) => (
                              <th
                                key={h}
                                style={{ padding: "10px 12px", fontWeight: 600, color: "#6B7280", whiteSpace: "nowrap" }}
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {shifts.map((s: any) => (
                            <tr key={s.id} style={{ borderTop: "1px solid #F3F4F6" }}>
                              <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                                {formatDateOnly(s.openedAt)}
                              </td>
                              <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                                <div className="flex items-center gap-2">
                                  {s.status === "OPEN" && (
                                    <span
                                      style={{
                                        width: "8px",
                                        height: "8px",
                                        borderRadius: "50%",
                                        background: "#16A34A",
                                        display: "inline-block",
                                      }}
                                      title="Зміна триває"
                                    />
                                  )}
                                  {s.userName}
                                </div>
                              </td>
                              <td style={{ padding: "10px 12px", fontWeight: 600, color: "#16A34A", whiteSpace: "nowrap" }}>
                                {formatTime(s.openedAt)}
                              </td>
                              <td style={{ padding: "10px 12px", fontWeight: 600, color: s.closedAt ? "#DC2626" : "#6B7280", whiteSpace: "nowrap" }}>
                                {s.closedAt ? formatTime(s.closedAt) : "на зміні"}
                              </td>
                              <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                                {s.durationMinutes != null ? formatHours(s.durationMinutes / 60) : "—"}
                              </td>
                              <td style={{ padding: "10px 12px", color: "#6B7280", maxWidth: "220px" }}>
                                <GeoCell address={s.openAddress} lat={s.openLat} lng={s.openLng} />
                              </td>
                              <td style={{ padding: "10px 12px", color: "#6B7280", maxWidth: "220px" }}>
                                <GeoCell address={s.closeAddress} lat={s.closeLat} lng={s.closeLng} />
                              </td>
                              <td style={{ padding: "10px 12px" }}>{s.reportsCount}</td>
                              <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                                {formatPrice(s.reportsAmount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Лайтбокс фото */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            cursor: "zoom-out",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Накладна"
            style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: "8px" }}
          />
        </div>
      )}
    </div>
  );
}
