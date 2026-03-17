"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Чернетка", CONFIRMED: "Підтверджено", PACKING: "Пакування",
  IN_TRANSIT: "В дорозі", DELIVERED: "Доставлено", CANCELLED: "Скасовано",
};
const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#6B7280", CONFIRMED: "#2563EB", PACKING: "#D97706",
  IN_TRANSIT: "#7C3AED", DELIVERED: "#16A34A", CANCELLED: "#DC2626",
};
const STATUS_BG: Record<string, string> = {
  DRAFT: "#F3F4F6", CONFIRMED: "#EFF6FF", PACKING: "#FEF3C7",
  IN_TRANSIT: "#F5F3FF", DELIVERED: "#F0FDF4", CANCELLED: "#FEF2F2",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: "Не оплачено", PARTIAL: "Частково", PAID: "Оплачено",
};

type PeriodPreset = "today" | "week" | "month" | "quarter" | "year" | "all";

function getDateRange(preset: PeriodPreset): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  let from = "";

  switch (preset) {
    case "today":
      from = to;
      break;
    case "week": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      from = d.toISOString().slice(0, 10);
      break;
    }
    case "month": {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 1);
      from = d.toISOString().slice(0, 10);
      break;
    }
    case "quarter": {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 3);
      from = d.toISOString().slice(0, 10);
      break;
    }
    case "year": {
      from = `${now.getFullYear()}-01-01`;
      break;
    }
    case "all":
      from = "";
      break;
  }
  return { from, to };
}

export default function AnalyticsPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [period, setPeriod] = useState<PeriodPreset>("month");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedRep, setSelectedRep] = useState("ALL");
  const [selectedStatus, setSelectedStatus] = useState("ALL");
  const [searchOrder, setSearchOrder] = useState("");

  // Tabs
  const [activeTab, setActiveTab] = useState<"overview" | "orders" | "reps" | "payments" | "bolts">("overview");

  // Order detail
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  const role = (session?.user as any)?.role;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    const range = period !== "all" ? getDateRange(period) : { from: fromDate, to: toDate };
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    if (selectedRep !== "ALL") params.set("repId", selectedRep);
    if (selectedStatus !== "ALL") params.set("status", selectedStatus);
    const res = await fetch(`/api/admin/analytics?${params}`);
    const json = await res.json();
    setData(json);
    setLoading(false);
  }, [period, fromDate, toDate, selectedRep, selectedStatus]);

  useEffect(() => {
    if (["ADMIN", "MANAGER"].includes(role)) fetchData();
  }, [role, fetchData]);

  if (!["ADMIN", "MANAGER"].includes(role)) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-lg font-bold">Доступ заборонено</p></div>;
  }

  const kpis = data?.kpis;
  const filteredOrders = (data?.orders || []).filter((o: any) =>
    !searchOrder || o.number?.toLowerCase().includes(searchOrder.toLowerCase()) ||
    o.counterparty?.name?.toLowerCase().includes(searchOrder.toLowerCase()) ||
    o.salesRep?.name?.toLowerCase().includes(searchOrder.toLowerCase())
  );

  // Aggregate daily into weekly/monthly for chart
  const dailyData = data?.daily || [];

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF" }}>
        <div className="max-w-7xl mx-auto" style={{ padding: "14px 24px" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Link href="/admin" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              <div>
                <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#0A0A0A" }}>Аналітика</h1>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Замовлення, оборот, платежі, бонуси</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto" style={{ background: "#F3F4F6", borderRadius: "10px", padding: "3px" }}>
            {([
              ["overview", "Огляд"],
              ["orders", "Замовлення"],
              ["reps", "Торгові"],
              ["payments", "Платежі"],
              ["bolts", "Бонуси"],
            ] as [string, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setActiveTab(key as any)}
                style={{ padding: "8px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap",
                  background: activeTab === key ? "white" : "transparent",
                  color: activeTab === key ? "#0A0A0A" : "#6B7280",
                  boxShadow: activeTab === key ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "16px", paddingBottom: "40px" }}>
        {/* Filters bar */}
        <div className="flex flex-wrap gap-3 mb-5 items-end">
          {/* Period presets */}
          <div className="flex gap-1" style={{ background: "#fff", borderRadius: "8px", padding: "2px", border: "1px solid #E5E7EB" }}>
            {([
              ["today", "Сьогодні"],
              ["week", "Тиждень"],
              ["month", "Місяць"],
              ["quarter", "Квартал"],
              ["year", "Рік"],
              ["all", "Все"],
            ] as [PeriodPreset, string][]).map(([key, label]) => (
              <button key={key} onClick={() => setPeriod(key)}
                style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 500,
                  background: period === key ? "#0A0A0A" : "transparent",
                  color: period === key ? "white" : "#6B7280" }}>
                {label}
              </button>
            ))}
          </div>

          {/* Custom dates (visible in "all" mode) */}
          {period === "all" && (
            <>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px" }} />
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px" }} />
              <button onClick={fetchData}
                style={{ padding: "6px 14px", borderRadius: "8px", fontWeight: 600, fontSize: "13px", background: "#FFD600" }}>
                Застосувати
              </button>
            </>
          )}

          {/* Rep filter */}
          <select value={selectedRep} onChange={(e) => setSelectedRep(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px", background: "white" }}>
            <option value="ALL">Всі торгові</option>
            {(data?.salesReps || []).map((r: any) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>

          {/* Status filter */}
          <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px", background: "white" }}>
            <option value="ALL">Всі статуси</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-16" style={{ color: "#9CA3AF" }}>Завантаження аналітики...</div>
        ) : (
          <>
            {/* ===== OVERVIEW TAB ===== */}
            {activeTab === "overview" && (
              <>
                {/* KPI cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
                  <KpiCard label="Замовлень" value={String(kpis?.totalOrders || 0)} />
                  <KpiCard label="Оборот" value={formatPrice(kpis?.totalRevenue || 0)} highlight />
                  <KpiCard label="Прибуток" value={formatPrice(kpis?.totalProfit || 0)} color="#16A34A" />
                  <KpiCard label="Середній чек" value={formatPrice(kpis?.avgOrderValue || 0)} />
                  <KpiCard label="Маржа" value={`${(kpis?.avgMargin || 0).toFixed(1)}%`} />
                  <KpiCard label="Знижки" value={formatPrice(kpis?.totalDiscount || 0)} color="#DC2626" />
                </div>

                {/* Status breakdown */}
                <div className="bg-white rounded-xl p-5 mb-6" style={{ border: "1px solid #EFEFEF" }}>
                  <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>Статуси замовлень</h3>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                    {Object.entries(data?.statusCounts || {}).map(([st, count]) => (
                      <button key={st} onClick={() => { setSelectedStatus(st); setActiveTab("orders"); }}
                        className="rounded-xl p-3 text-center transition-shadow hover:shadow-md"
                        style={{ background: STATUS_BG[st], border: `1px solid ${STATUS_COLORS[st]}20` }}>
                        <p style={{ fontSize: "24px", fontWeight: 700, color: STATUS_COLORS[st] }}>{count as number}</p>
                        <p style={{ fontSize: "12px", fontWeight: 600, color: STATUS_COLORS[st] }}>{STATUS_LABELS[st]}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Revenue chart */}
                {dailyData.length > 0 && (
                  <div className="bg-white rounded-xl p-5 mb-6" style={{ border: "1px solid #EFEFEF" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "16px" }}>Оборот по днях</h3>
                    <RevenueChart data={dailyData} />
                  </div>
                )}

                {/* Two columns: payments + commissions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  {/* Payments summary */}
                  <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>Надходження коштів</h3>
                    <PaymentDonut cash={data?.payments?.cash || 0} bank={data?.payments?.bank || 0} other={data?.payments?.other || 0} />
                  </div>

                  {/* Commissions summary */}
                  <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>Комісії торгових</h3>
                    {(data?.commissions || []).length > 0 ? (
                      <div className="space-y-3">
                        {data.commissions.map((c: any) => (
                          <div key={c.status} className="flex items-center justify-between p-3 rounded-lg" style={{ background: "#F9FAFB" }}>
                            <div>
                              <span style={{ fontSize: "14px", fontWeight: 600 }}>
                                {c.status === "PENDING" ? "Очікує" : c.status === "APPROVED" ? "Затверджено" : "Виплачено"}
                              </span>
                              <span style={{ fontSize: "12px", color: "#6B7280", marginLeft: "8px" }}>{c.count} записів</span>
                            </div>
                            <span style={{ fontSize: "16px", fontWeight: 700, color: c.status === "PAID" ? "#16A34A" : "#0A0A0A" }}>
                              {formatPrice(c.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : <p style={{ color: "#9CA3AF", fontSize: "14px" }}>Немає даних</p>}
                  </div>
                </div>

                {/* Top clients */}
                {(data?.topClients || []).length > 0 && (
                  <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>Топ клієнти</h3>
                    <div className="space-y-2">
                      {data.topClients.slice(0, 10).map((c: any, i: number) => {
                        const maxRev = data.topClients[0].revenue;
                        const pct = maxRev > 0 ? (c.revenue / maxRev) * 100 : 0;
                        return (
                          <div key={c.id}>
                            <div className="flex items-center justify-between mb-1">
                              <span style={{ fontSize: "14px", fontWeight: 500 }}>
                                <span style={{ color: "#9CA3AF", marginRight: "8px" }}>{i + 1}.</span>{c.name}
                              </span>
                              <span style={{ fontSize: "13px", color: "#6B7280" }}>
                                {formatPrice(c.revenue)} | {c.count} зам. | прибуток {formatPrice(c.profit)}
                              </span>
                            </div>
                            <div style={{ height: "4px", background: "#F3F4F6", borderRadius: "2px" }}>
                              <div style={{ height: "4px", width: `${pct}%`, background: "#FFD600", borderRadius: "2px" }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ===== ORDERS TAB ===== */}
            {activeTab === "orders" && (
              <>
                <div className="mb-4">
                  <input value={searchOrder} onChange={(e) => setSearchOrder(e.target.value)}
                    placeholder="Пошук за номером, клієнтом, торговим..."
                    style={{ width: "100%", maxWidth: "400px", padding: "10px 14px", borderRadius: "10px",
                      border: "1px solid #E5E7EB", fontSize: "14px", background: "white" }} />
                </div>

                <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF" }}>
                  <div className="overflow-x-auto">
                    <table style={{ width: "100%", fontSize: "14px", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
                          <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Номер</th>
                          <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Дата</th>
                          <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Клієнт</th>
                          <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Торговий</th>
                          <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Статус</th>
                          <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Оплата</th>
                          <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Сума</th>
                          <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Прибуток</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOrders.length === 0 ? (
                          <tr><td colSpan={8} className="text-center" style={{ padding: "24px", color: "#9CA3AF" }}>Замовлень не знайдено</td></tr>
                        ) : filteredOrders.map((o: any) => (
                          <>
                            <tr key={o.id} onClick={() => setExpandedOrder(expandedOrder === o.id ? null : o.id)}
                              className="hover:bg-gray-50 cursor-pointer" style={{ borderBottom: "1px solid #F3F4F6" }}>
                              <td style={{ padding: "10px 16px", fontWeight: 600 }}>{o.number}</td>
                              <td style={{ padding: "10px 16px", color: "#6B7280", fontSize: "13px", whiteSpace: "nowrap" }}>{formatDate(o.createdAt)}</td>
                              <td style={{ padding: "10px 16px", maxWidth: "180px" }} className="truncate">{o.counterparty?.name || "—"}</td>
                              <td style={{ padding: "10px 16px", color: "#6B7280" }}>{o.salesRep?.name || "—"}</td>
                              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                <span style={{ fontSize: "11px", fontWeight: 700, padding: "3px 8px", borderRadius: "6px",
                                  background: STATUS_BG[o.status], color: STATUS_COLORS[o.status] }}>
                                  {STATUS_LABELS[o.status]}
                                </span>
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                {o.invoiceStatus ? (
                                  <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 6px", borderRadius: "4px",
                                    background: o.invoiceStatus === "PAID" ? "#F0FDF4" : o.invoiceStatus === "PARTIAL" ? "#FEF3C7" : "#FEF2F2",
                                    color: o.invoiceStatus === "PAID" ? "#16A34A" : o.invoiceStatus === "PARTIAL" ? "#D97706" : "#DC2626" }}>
                                    {PAYMENT_STATUS_LABELS[o.invoiceStatus]}
                                  </span>
                                ) : <span style={{ fontSize: "11px", color: "#D1D5DB" }}>—</span>}
                              </td>
                              <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600 }}>{formatPrice(o.totalAmount)}</td>
                              <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: "#16A34A" }}>{formatPrice(o.profitAmount)}</td>
                            </tr>
                            {expandedOrder === o.id && (
                              <tr key={`${o.id}-detail`}>
                                <td colSpan={8} style={{ padding: "0 16px 16px", background: "#F9FAFB" }}>
                                  <div className="flex flex-wrap gap-4 pt-3">
                                    {o.itemsSummary?.map((item: any, idx: number) => (
                                      <div key={idx} className="flex items-center gap-2">
                                        {item.image && <img src={item.image} alt="" style={{ width: "36px", height: "36px", borderRadius: "6px", objectFit: "cover" }} />}
                                        <div>
                                          <p style={{ fontSize: "13px", fontWeight: 500 }} className="truncate" title={item.name}>{item.name}</p>
                                          <p style={{ fontSize: "12px", color: "#6B7280" }}>{item.qty} x {formatPrice(item.price)}</p>
                                        </div>
                                      </div>
                                    ))}
                                    {o.itemCount > 3 && (
                                      <span style={{ fontSize: "12px", color: "#9CA3AF", alignSelf: "center" }}>...ще {o.itemCount - 3}</span>
                                    )}
                                  </div>
                                  <div className="flex gap-4 mt-2" style={{ fontSize: "12px", color: "#6B7280" }}>
                                    {o.deliveryMethod && <span>Доставка: {o.deliveryMethod === "DRIVER" ? "Водій" : o.deliveryMethod === "SALES_REP_PICKUP" ? "Торговий" : "Самовивіз"}</span>}
                                    {o.routeNumber && <span>Маршрут: {o.routeNumber}</span>}
                                    {o.deliveryStatus && <span>Доставка: {o.deliveryStatus}</span>}
                                    {o.paidAmount > 0 && <span>Оплачено: {formatPrice(o.paidAmount)}</span>}
                                    {o.discountAmount > 0 && <span>Знижка: {formatPrice(o.discountAmount)}</span>}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ padding: "12px 16px", borderTop: "1px solid #F3F4F6", background: "#F9FAFB" }}>
                    <p style={{ fontSize: "13px", color: "#6B7280" }}>
                      Показано {filteredOrders.length} замовлень | Сума: <b>{formatPrice(filteredOrders.reduce((s: number, o: any) => s + (o.status !== "CANCELLED" ? o.totalAmount : 0), 0))}</b>
                      {" "}| Прибуток: <b style={{ color: "#16A34A" }}>{formatPrice(filteredOrders.reduce((s: number, o: any) => s + (o.status !== "CANCELLED" ? o.profitAmount : 0), 0))}</b>
                    </p>
                  </div>
                </div>
              </>
            )}

            {/* ===== REPS TAB ===== */}
            {activeTab === "reps" && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(data?.byRep || []).map((rep: any) => (
                    <div key={rep.id} className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-11 h-11 rounded-full flex items-center justify-center"
                          style={{ background: "#FFF7ED", color: "#D97706", fontWeight: 700, fontSize: "18px" }}>
                          {rep.name?.charAt(0)?.toUpperCase() || "?"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p style={{ fontSize: "16px", fontWeight: 700 }} className="truncate">{rep.name}</p>
                          <p style={{ fontSize: "12px", color: "#6B7280" }}>{rep.count} замовлень | маржа {rep.margin}%</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg p-3" style={{ background: "#F9FAFB" }}>
                          <p style={{ fontSize: "11px", color: "#6B7280", fontWeight: 600 }}>ОБОРОТ</p>
                          <p style={{ fontSize: "18px", fontWeight: 700 }}>{formatPrice(rep.revenue)}</p>
                        </div>
                        <div className="rounded-lg p-3" style={{ background: "#F0FDF4" }}>
                          <p style={{ fontSize: "11px", color: "#16A34A", fontWeight: 600 }}>ПРИБУТОК</p>
                          <p style={{ fontSize: "18px", fontWeight: 700, color: "#16A34A" }}>{formatPrice(rep.profit)}</p>
                        </div>
                      </div>

                      <div className="flex gap-3 mt-3">
                        <div className="flex-1 rounded-lg p-2 text-center" style={{ background: "#EFF6FF" }}>
                          <p style={{ fontSize: "18px", fontWeight: 700, color: "#2563EB" }}>{rep.confirmed}</p>
                          <p style={{ fontSize: "10px", color: "#2563EB", fontWeight: 600 }}>Підтверджено</p>
                        </div>
                        <div className="flex-1 rounded-lg p-2 text-center" style={{ background: "#F0FDF4" }}>
                          <p style={{ fontSize: "18px", fontWeight: 700, color: "#16A34A" }}>{rep.delivered}</p>
                          <p style={{ fontSize: "10px", color: "#16A34A", fontWeight: 600 }}>Доставлено</p>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-3">
                        <div className="flex justify-between mb-1">
                          <span style={{ fontSize: "11px", color: "#9CA3AF" }}>Виконання</span>
                          <span style={{ fontSize: "11px", fontWeight: 600 }}>
                            {rep.count > 0 ? Math.round((rep.delivered / rep.count) * 100) : 0}%
                          </span>
                        </div>
                        <div style={{ height: "6px", background: "#F3F4F6", borderRadius: "3px" }}>
                          <div style={{ height: "6px", borderRadius: "3px", background: "linear-gradient(to right, #FFD600, #16A34A)",
                            width: `${rep.count > 0 ? (rep.delivered / rep.count) * 100 : 0}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {(data?.byRep || []).length === 0 && (
                  <div className="text-center py-16"><p style={{ color: "#9CA3AF" }}>Немає даних по торговим</p></div>
                )}
              </>
            )}

            {/* ===== PAYMENTS TAB ===== */}
            {activeTab === "payments" && (
              <>
                {/* Payment KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <KpiCard label="Готівка" value={formatPrice(data?.payments?.cash || 0)} color="#16A34A" />
                  <KpiCard label="Безготівка" value={formatPrice(data?.payments?.bank || 0)} color="#2563EB" />
                  <KpiCard label="Інше" value={formatPrice(data?.payments?.other || 0)} />
                  <KpiCard label="Всього оплат" value={formatPrice(data?.payments?.total || 0)} highlight />
                </div>

                {/* Payment pie */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "16px" }}>Розподіл оплат</h3>
                    <PaymentDonut cash={data?.payments?.cash || 0} bank={data?.payments?.bank || 0} other={data?.payments?.other || 0} />
                  </div>

                  {/* Invoice statuses */}
                  <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>Рахунки (накладні)</h3>
                    {(data?.invoices || []).length > 0 ? (
                      <div className="space-y-3">
                        {data.invoices.map((inv: any) => {
                          const remaining = (inv.total || 0) - (inv.paid || 0);
                          return (
                            <div key={inv.status} className="p-4 rounded-xl" style={{ background: "#F9FAFB" }}>
                              <div className="flex items-center justify-between mb-2">
                                <span style={{ fontSize: "14px", fontWeight: 700 }}>{PAYMENT_STATUS_LABELS[inv.status] || inv.status}</span>
                                <span style={{ fontSize: "12px", color: "#6B7280" }}>{inv.count} шт.</span>
                              </div>
                              <div className="grid grid-cols-3 gap-2" style={{ fontSize: "13px" }}>
                                <div>
                                  <p style={{ color: "#9CA3AF", fontSize: "11px" }}>Сума</p>
                                  <p style={{ fontWeight: 600 }}>{formatPrice(inv.total)}</p>
                                </div>
                                <div>
                                  <p style={{ color: "#9CA3AF", fontSize: "11px" }}>Оплачено</p>
                                  <p style={{ fontWeight: 600, color: "#16A34A" }}>{formatPrice(inv.paid)}</p>
                                </div>
                                <div>
                                  <p style={{ color: "#9CA3AF", fontSize: "11px" }}>Борг</p>
                                  <p style={{ fontWeight: 600, color: remaining > 0 ? "#DC2626" : "#16A34A" }}>{formatPrice(remaining)}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : <p style={{ color: "#9CA3AF", fontSize: "14px" }}>Немає рахунків</p>}
                  </div>
                </div>
              </>
            )}

            {/* ===== BOLTS TAB ===== */}
            {activeTab === "bolts" && (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <KpiCard label="Нараховано болтів" value={`${(data?.bolts?.earned || 0).toFixed(0)}`} color="#D97706" />
                  <KpiCard label="Витрачено болтів" value={`${(data?.bolts?.spent || 0).toFixed(0)}`} color="#DC2626" />
                  <KpiCard label="Баланс клієнтів" value={`${(data?.bolts?.totalBalance || 0).toFixed(0)}`} highlight />
                  <KpiCard label="Чисте зобов'язання" value={formatPrice((data?.bolts?.totalBalance || 0))} color="#7C3AED" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "16px" }}>Статистика болтів</h3>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: "#FFF7ED" }}>
                        <div>
                          <p style={{ fontSize: "13px", color: "#92400E", fontWeight: 600 }}>Нараховано</p>
                          <p style={{ fontSize: "12px", color: "#B45309" }}>{data?.bolts?.earnedCount || 0} транзакцій</p>
                        </div>
                        <p style={{ fontSize: "24px", fontWeight: 700, color: "#D97706" }}>+{(data?.bolts?.earned || 0).toFixed(0)}</p>
                      </div>
                      <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: "#FEF2F2" }}>
                        <div>
                          <p style={{ fontSize: "13px", color: "#991B1B", fontWeight: 600 }}>Витрачено</p>
                          <p style={{ fontSize: "12px", color: "#B91C1C" }}>{data?.bolts?.spentCount || 0} транзакцій</p>
                        </div>
                        <p style={{ fontSize: "24px", fontWeight: 700, color: "#DC2626" }}>-{(data?.bolts?.spent || 0).toFixed(0)}</p>
                      </div>
                      <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: "#F5F3FF" }}>
                        <div>
                          <p style={{ fontSize: "13px", color: "#5B21B6", fontWeight: 600 }}>Загальний баланс клієнтів</p>
                          <p style={{ fontSize: "12px", color: "#6D28D9" }}>Еквівалент у грн</p>
                        </div>
                        <p style={{ fontSize: "24px", fontWeight: 700, color: "#7C3AED" }}>{formatPrice(data?.bolts?.totalBalance || 0)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "16px" }}>Як працюють болти</h3>
                    <div className="space-y-3" style={{ fontSize: "14px", color: "#374151" }}>
                      <div className="p-3 rounded-lg" style={{ background: "#F9FAFB" }}>
                        <p style={{ fontWeight: 600 }}>Нарахування</p>
                        <p style={{ fontSize: "13px", color: "#6B7280" }}>5% кешбек від суми замовлення</p>
                      </div>
                      <div className="p-3 rounded-lg" style={{ background: "#F9FAFB" }}>
                        <p style={{ fontWeight: 600 }}>Використання</p>
                        <p style={{ fontSize: "13px", color: "#6B7280" }}>До 30% від суми нового замовлення</p>
                      </div>
                      <div className="p-3 rounded-lg" style={{ background: "#F9FAFB" }}>
                        <p style={{ fontWeight: 600 }}>Курс</p>
                        <p style={{ fontSize: "13px", color: "#6B7280" }}>1 болт = 1 грн</p>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ===== COMPONENTS ===== */

function KpiCard({ label, value, color, highlight }: { label: string; value: string; color?: string; highlight?: boolean }) {
  return (
    <div className="bg-white rounded-xl p-4" style={{ border: highlight ? "2px solid #FFD600" : "1px solid #EFEFEF",
      boxShadow: highlight ? "0 0 0 3px rgba(255,214,0,0.15)" : "0 1px 4px rgba(0,0,0,0.04)" }}>
      <p style={{ fontSize: "12px", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</p>
      <p style={{ fontSize: "20px", fontWeight: 700, color: color || "#0A0A0A", marginTop: "4px" }}>{value}</p>
    </div>
  );
}

function RevenueChart({ data }: { data: any[] }) {
  if (data.length === 0) return null;
  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);

  // Show last 30 days max
  const displayed = data.slice(-30);

  return (
    <div className="flex items-end gap-[2px]" style={{ height: "180px" }}>
      {displayed.map((d) => {
        const h = (d.revenue / maxRevenue) * 100;
        const profitH = maxRevenue > 0 ? (d.profit / maxRevenue) * 100 : 0;
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center justify-end" style={{ height: "100%", minWidth: "0" }}
            title={`${d.date}\nОборот: ${d.revenue.toFixed(0)} грн\nПрибуток: ${d.profit.toFixed(0)} грн\nЗамовлень: ${d.count}`}>
            <div style={{ width: "100%", maxWidth: "24px", position: "relative" }}>
              <div style={{ height: `${h}%`, minHeight: d.revenue > 0 ? "2px" : "0px",
                background: "linear-gradient(to top, #FFD600, #FFC400)", borderRadius: "2px 2px 0 0", position: "relative" }}>
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${profitH > 0 ? (profitH / h) * 100 : 0}%`,
                  background: "rgba(22,163,74,0.3)", borderRadius: "2px 2px 0 0" }} />
              </div>
            </div>
            {displayed.length <= 14 && (
              <span style={{ fontSize: "9px", color: "#9CA3AF", marginTop: "2px", writingMode: "vertical-rl", transform: "rotate(180deg)", maxHeight: "40px", overflow: "hidden" }}>
                {d.date.slice(5)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PaymentDonut({ cash, bank, other }: { cash: number; bank: number; other: number }) {
  const total = cash + bank + other;
  if (total === 0) return <p style={{ color: "#9CA3AF", fontSize: "14px" }}>Немає оплат за цей період</p>;

  const cashPct = (cash / total) * 100;
  const bankPct = (bank / total) * 100;
  const otherPct = (other / total) * 100;

  const segments = [
    { label: "Готівка", value: cash, pct: cashPct, color: "#16A34A" },
    { label: "Безготівка", value: bank, pct: bankPct, color: "#2563EB" },
    { label: "Інше", value: other, pct: otherPct, color: "#9CA3AF" },
  ].filter((s) => s.value > 0);

  return (
    <div>
      {/* Horizontal bar */}
      <div className="flex rounded-lg overflow-hidden mb-4" style={{ height: "24px" }}>
        {segments.map((s) => (
          <div key={s.label} style={{ width: `${s.pct}%`, background: s.color, minWidth: s.pct > 0 ? "2px" : "0" }}
            title={`${s.label}: ${s.pct.toFixed(1)}%`} />
        ))}
      </div>
      <div className="space-y-2">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div style={{ width: "10px", height: "10px", borderRadius: "3px", background: s.color }} />
              <span style={{ fontSize: "14px", fontWeight: 500 }}>{s.label}</span>
            </div>
            <div className="text-right">
              <span style={{ fontSize: "14px", fontWeight: 700 }}>{formatPrice(s.value)}</span>
              <span style={{ fontSize: "12px", color: "#6B7280", marginLeft: "8px" }}>{s.pct.toFixed(1)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
