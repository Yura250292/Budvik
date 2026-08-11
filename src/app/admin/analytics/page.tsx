"use client";

/**
 * «Аналітика» — фінансовий бік циклу продажу за даними 1С:
 * замовлення → надходження грошей → заборгованість.
 *
 * Показуємо лише те, що 1С реально заповнює (див. коментар в
 * api/admin/analytics/route.ts). Відвантаження, КПІ і люди — в
 * «Аналітиці торгових»: там ті самі торгові, але за реалізаціями,
 * тому цифри обігу тут і там навмисно НЕ збігаються.
 */

import { useSession } from "next-auth/react";
import { Fragment, Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";
import { TableScroll } from "@/components/ui/TableScroll";

type Tab = "overview" | "orders" | "payments" | "debts";
const TABS: [Tab, string][] = [
  ["overview", "Огляд"],
  ["orders", "Замовлення"],
  ["payments", "Платежі"],
  ["debts", "Борги"],
];

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

function AnalyticsPageInner() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [period, setPeriod] = useState<PeriodPreset>("month");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedRep, setSelectedRep] = useState("ALL");
  const [searchOrder, setSearchOrder] = useState("");

  // Вкладка живе в URL (?tab=), щоб на неї можна було послатися ззовні.
  // Невідомі значення (у т.ч. колишні reps/bolts/purchases) падають в огляд.
  const tabParam = searchParams.get("tab");
  const activeTab: Tab = TABS.some(([k]) => k === tabParam) ? (tabParam as Tab) : "overview";
  const setActiveTab = (tab: Tab) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "overview") params.delete("tab");
    else params.set("tab", tab);
    // replace, а не push: перемикання вкладок не має засмічувати історію,
    // інакше «назад» ходить по вкладках замість повернення в /admin.
    router.replace(params.toString() ? `/admin/analytics?${params}` : "/admin/analytics", { scroll: false });
  };

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
    const res = await fetch(`/api/admin/analytics?${params}`);
    setData(await res.json());
    setLoading(false);
  }, [period, fromDate, toDate, selectedRep]);

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
                <p style={{ fontSize: "13px", color: "#6B7280" }}>
                  Замовлення, надходження, борги — за даними 1С
                </p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto" style={{ background: "#F3F4F6", borderRadius: "10px", padding: "3px" }}>
            {TABS.map(([key, label]) => (
              <button key={key} onClick={() => setActiveTab(key)}
                style={{ padding: "8px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer",
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
        {/* Filters bar. Борги — стан «на зараз», період на них не діє. */}
        {activeTab !== "debts" && (
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
                  style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: 500, cursor: "pointer",
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
                  style={{ padding: "6px 14px", borderRadius: "8px", fontWeight: 600, fontSize: "13px", background: "#FFD600", cursor: "pointer" }}>
                  Застосувати
                </button>
              </>
            )}

            {/* Rep filter — діє на замовлення; надходження в 1С не прив'язані
                до торгового, тож на вкладці «Платежі» його не показуємо. */}
            {activeTab !== "payments" && (
              <select value={selectedRep} onChange={(e) => setSelectedRep(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px", background: "white", cursor: "pointer" }}>
                <option value="ALL">Всі торгові</option>
                {(data?.salesReps || []).map((r: any) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {loading ? (
          <div className="text-center py-16" style={{ color: "#9CA3AF" }}>Завантаження аналітики...</div>
        ) : (
          <>
            {/* ===== OVERVIEW TAB ===== */}
            {activeTab === "overview" && (
              <>
                {/* KPI cards */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
                  <KpiCard label="Замовлень" value={String(kpis?.totalOrders || 0)} />
                  <KpiCard label="Оборот" value={formatPrice(kpis?.totalRevenue || 0)} highlight />
                  <KpiCard label="Середній чек" value={formatPrice(kpis?.avgOrderValue || 0)} />
                  <KpiCard label="Надходження" value={formatPrice(data?.payments?.total || 0)} color="#16A34A"
                    onClick={() => setActiveTab("payments")} />
                  <KpiCard label="Заборгованість" value={formatPrice(data?.debts?.total || 0)} color="#DC2626"
                    onClick={() => setActiveTab("debts")} />
                </div>

                {/* Revenue chart */}
                {dailyData.length > 0 && (
                  <div className="bg-white rounded-xl p-5 mb-6" style={{ border: "1px solid #EFEFEF" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "16px" }}>Оборот по днях</h3>
                    <RevenueChart data={dailyData} />
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Top clients */}
                  <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px" }}>Топ клієнти за замовленнями</h3>
                    {(data?.topClients || []).length > 0 ? (
                      <div className="space-y-2">
                        {data.topClients.slice(0, 10).map((c: any, i: number) => {
                          const maxRev = data.topClients[0].revenue;
                          const pct = maxRev > 0 ? (c.revenue / maxRev) * 100 : 0;
                          return (
                            <div key={c.id}>
                              <div className="flex items-center justify-between mb-1 gap-3">
                                <span className="truncate" style={{ fontSize: "14px", fontWeight: 500 }}>
                                  <span style={{ color: "#9CA3AF", marginRight: "8px" }}>{i + 1}.</span>{c.name}
                                </span>
                                <span style={{ fontSize: "13px", color: "#6B7280", whiteSpace: "nowrap" }}>
                                  {formatPrice(c.revenue)} · {c.count} зам.
                                </span>
                              </div>
                              <div style={{ height: "4px", background: "#F3F4F6", borderRadius: "2px" }}>
                                <div style={{ height: "4px", width: `${pct}%`, background: "#FFD600", borderRadius: "2px" }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : <p style={{ color: "#9CA3AF", fontSize: "14px" }}>Немає замовлень за період</p>}
                  </div>

                  {/* Top debtors preview */}
                  <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                    <div className="flex items-center justify-between mb-3">
                      <h3 style={{ fontSize: "16px", fontWeight: 700 }}>Найбільші борги</h3>
                      <button onClick={() => setActiveTab("debts")}
                        style={{ fontSize: "13px", fontWeight: 600, color: "#6B7280", cursor: "pointer" }}
                        className="hover:underline">
                        Всі борги →
                      </button>
                    </div>
                    {(data?.debts?.top || []).length > 0 ? (
                      <div className="space-y-2.5">
                        {data.debts.top.slice(0, 10).map((c: any) => (
                          <div key={c.id} className="flex items-center justify-between gap-3">
                            <span className="truncate" style={{ fontSize: "14px" }}>{c.name}</span>
                            <span style={{ fontSize: "14px", fontWeight: 700, color: "#DC2626", whiteSpace: "nowrap" }}>
                              {formatPrice(c.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : <p style={{ color: "#9CA3AF", fontSize: "14px" }}>Боргів немає</p>}
                  </div>
                </div>
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
                  <TableScroll minWidth={720}>
                    <table style={{ width: "100%", fontSize: "14px", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
                          <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Номер</th>
                          <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Дата</th>
                          <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Клієнт</th>
                          <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Торговий</th>
                          <th style={{ padding: "10px 12px", textAlign: "center", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Оплата</th>
                          <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Сума</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOrders.length === 0 ? (
                          <tr><td colSpan={6} className="text-center" style={{ padding: "24px", color: "#9CA3AF" }}>Замовлень не знайдено</td></tr>
                        ) : filteredOrders.map((o: any) => (
                          <Fragment key={o.id}>
                            <tr onClick={() => setExpandedOrder(expandedOrder === o.id ? null : o.id)}
                              className="hover:bg-gray-50 cursor-pointer" style={{ borderBottom: "1px solid #F3F4F6" }}>
                              <td style={{ padding: "10px 16px", fontWeight: 600 }}>{o.number}</td>
                              <td style={{ padding: "10px 16px", color: "#6B7280", fontSize: "13px", whiteSpace: "nowrap" }}>{formatDate(o.createdAt)}</td>
                              <td style={{ padding: "10px 16px", maxWidth: "220px" }} className="truncate">{o.counterparty?.name || "—"}</td>
                              <td style={{ padding: "10px 16px", color: "#6B7280" }}>{o.salesRep?.name || "—"}</td>
                              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                {o.invoiceStatus === "PAID" ? (
                                  <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 6px", borderRadius: "4px", background: "#F0FDF4", color: "#16A34A" }}>
                                    Оплачено
                                  </span>
                                ) : o.invoiceStatus === "PARTIAL" ? (
                                  <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 6px", borderRadius: "4px", background: "#FEF3C7", color: "#D97706" }}>
                                    Частково
                                  </span>
                                ) : <span style={{ fontSize: "11px", color: "#D1D5DB" }}>—</span>}
                              </td>
                              <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600 }}>{formatPrice(o.totalAmount)}</td>
                            </tr>
                            {expandedOrder === o.id && (
                              <tr>
                                <td colSpan={6} style={{ padding: "0 16px 16px", background: "#F9FAFB" }}>
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
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                  <div style={{ padding: "12px 16px", borderTop: "1px solid #F3F4F6", background: "#F9FAFB" }}>
                    <p style={{ fontSize: "13px", color: "#6B7280" }}>
                      Показано {filteredOrders.length} замовлень | Сума: <b>{formatPrice(filteredOrders.reduce((s: number, o: any) => s + o.totalAmount, 0))}</b>
                    </p>
                  </div>
                </div>
              </>
            )}

            {/* ===== PAYMENTS TAB ===== */}
            {activeTab === "payments" && (
              <>
                <div className="grid grid-cols-2 gap-4 mb-6 md:max-w-md">
                  <KpiCard label="Надходження за період" value={formatPrice(data?.payments?.total || 0)} highlight />
                  <KpiCard label="Оплат" value={String(data?.payments?.count || 0)} />
                </div>

                <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF" }}>
                  <div style={{ padding: "14px 16px", borderBottom: "1px solid #F3F4F6" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700 }}>Останні оплати</h3>
                    <p style={{ fontSize: "12px", color: "#9CA3AF" }}>
                      Прибуткові касові ордери з 1С за датою оплати
                    </p>
                  </div>
                  {(data?.payments?.recent || []).length === 0 ? (
                    <p className="text-center" style={{ padding: "24px", color: "#9CA3AF", fontSize: "14px" }}>
                      Оплат за цей період немає
                    </p>
                  ) : (
                    <TableScroll minWidth={520}>
                      <table style={{ width: "100%", fontSize: "14px", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Дата</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Клієнт</th>
                            <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Сума</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.payments.recent.map((p: any) => (
                            <tr key={p.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                              <td style={{ padding: "10px 16px", color: "#6B7280", fontSize: "13px", whiteSpace: "nowrap" }}>{formatDate(p.date)}</td>
                              <td style={{ padding: "10px 16px", maxWidth: "280px" }} className="truncate">{p.counterparty || "—"}</td>
                              <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: "#16A34A" }}>{formatPrice(p.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableScroll>
                  )}
                </div>
              </>
            )}

            {/* ===== DEBTS TAB ===== */}
            {activeTab === "debts" && (
              <>
                <div className="grid grid-cols-2 gap-4 mb-6 md:max-w-md">
                  <KpiCard label="Загальний борг" value={formatPrice(data?.debts?.total || 0)} color="#DC2626" highlight />
                  <KpiCard label="Боржників" value={String(data?.debts?.count || 0)} />
                </div>

                <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF" }}>
                  <div style={{ padding: "14px 16px", borderBottom: "1px solid #F3F4F6" }}>
                    <h3 style={{ fontSize: "16px", fontWeight: 700 }}>Найбільші боржники</h3>
                    <p style={{ fontSize: "12px", color: "#9CA3AF" }}>
                      Сальдо дебіторки за даними 1С, станом на останню синхронізацію
                    </p>
                  </div>
                  {(data?.debts?.top || []).length === 0 ? (
                    <p className="text-center" style={{ padding: "24px", color: "#9CA3AF", fontSize: "14px" }}>
                      Боргів немає
                    </p>
                  ) : (
                    <TableScroll minWidth={520}>
                      <table style={{ width: "100%", fontSize: "14px", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ background: "#F9FAFB", borderBottom: "1px solid #F3F4F6" }}>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Клієнт</th>
                            <th style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Телефон</th>
                            <th style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600, color: "#6B7280", fontSize: "12px" }}>Борг</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.debts.top.map((c: any) => (
                            <tr key={c.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                              <td style={{ padding: "10px 16px", maxWidth: "320px" }} className="truncate">{c.name}</td>
                              <td style={{ padding: "10px 16px", color: "#6B7280", fontSize: "13px", whiteSpace: "nowrap" }}>{c.phone || "—"}</td>
                              <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 700, color: "#DC2626" }}>{formatPrice(c.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableScroll>
                  )}
                  {(data?.debts?.count || 0) > (data?.debts?.top || []).length && (
                    <div style={{ padding: "12px 16px", borderTop: "1px solid #F3F4F6", background: "#F9FAFB" }}>
                      <p style={{ fontSize: "13px", color: "#6B7280" }}>
                        Показано топ-{data.debts.top.length} з {data.debts.count} боржників.{" "}
                        <Link href="/admin/erp/counterparties" style={{ fontWeight: 600, textDecoration: "underline" }}>
                          Усі контрагенти
                        </Link>
                      </p>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// useSearchParams вимагає Suspense — без нього збірка падає
// на прередері всієї сторінки.
export default function AnalyticsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center" style={{ color: "#9CA3AF" }}>Завантаження аналітики...</div>}>
      <AnalyticsPageInner />
    </Suspense>
  );
}

/* ===== COMPONENTS ===== */

function KpiCard({ label, value, color, highlight, onClick }: { label: string; value: string; color?: string; highlight?: boolean; onClick?: () => void }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp onClick={onClick} className={`bg-white rounded-xl p-4 text-left${onClick ? " cursor-pointer transition-shadow hover:shadow-md" : ""}`}
      style={{ border: highlight ? "2px solid #FFD600" : "1px solid #EFEFEF",
        boxShadow: highlight ? "0 0 0 3px rgba(255,214,0,0.15)" : "0 1px 4px rgba(0,0,0,0.04)" }}>
      <p style={{ fontSize: "12px", color: "#6B7280", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</p>
      <p style={{ fontSize: "20px", fontWeight: 700, color: color || "#0A0A0A", marginTop: "4px" }}>{value}</p>
    </Comp>
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
        return (
          <div key={d.date} className="flex-1 flex flex-col items-center justify-end" style={{ height: "100%", minWidth: "0" }}
            title={`${d.date}\nОборот: ${d.revenue.toFixed(0)} грн\nЗамовлень: ${d.count}`}>
            <div style={{ width: "100%", maxWidth: "24px" }}>
              <div style={{ height: `${(h / 100) * 160}px`, minHeight: d.revenue > 0 ? "2px" : "0px",
                background: "linear-gradient(to top, #FFD600, #FFC400)", borderRadius: "2px 2px 0 0" }} />
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
