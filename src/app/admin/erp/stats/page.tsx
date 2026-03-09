"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";

export default function StatsPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [tab, setTab] = useState<"sales" | "purchases">("sales");

  const role = (session?.user as any)?.role;

  const fetchData = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const res = await fetch(`/api/erp/stats?${params}`);
    setData(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    if (role === "ADMIN" || role === "SALES") fetchData();
  }, [role]);

  if (role !== "ADMIN" && role !== "SALES") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  const sales = data?.sales;
  const purchases = data?.purchases;

  // Find max value for bar chart scaling
  const maxMonthlySales = sales?.monthly?.reduce((m: number, d: any) => Math.max(m, d.sales), 0) || 1;

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
              <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Статистика</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Аналітика продажів та закупівель</p>
            </div>
          </div>
          {role === "ADMIN" && (
            <Link href="/admin/erp/reports" style={{ background: "white", color: "#0A0A0A", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", border: "1px solid #E5E7EB", textDecoration: "none" }}>
              Бухгалтерські звіти
            </Link>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {/* Date filter */}
        <div className="flex flex-wrap gap-3 mb-6 items-end">
          <div>
            <label className="block text-xs text-g400 mb-1">Від</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
          </div>
          <div>
            <label className="block text-xs text-g400 mb-1">До</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
          </div>
          <button onClick={fetchData} style={{ background: "#FFD600", padding: "8px 16px", borderRadius: "8px", fontWeight: 600, fontSize: "14px" }}>
            Застосувати
          </button>
          {/* Tabs */}
          <div className="flex gap-1 ml-auto" style={{ background: "#F3F4F6", borderRadius: "8px", padding: "2px" }}>
            <button onClick={() => setTab("sales")}
              style={{ padding: "6px 16px", borderRadius: "6px", fontSize: "14px", fontWeight: 500, background: tab === "sales" ? "white" : "transparent", boxShadow: tab === "sales" ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>
              Продажі
            </button>
            <button onClick={() => setTab("purchases")}
              style={{ padding: "6px 16px", borderRadius: "6px", fontSize: "14px", fontWeight: 500, background: tab === "purchases" ? "white" : "transparent", boxShadow: tab === "purchases" ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>
              Закупівлі
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12" style={{ color: "#9E9E9E" }}>Завантаження...</div>
        ) : tab === "sales" ? (
          <>
            {/* Sales summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Виручка</p>
                <p style={{ fontSize: "24px", fontWeight: 700 }}>{formatPrice(sales?.totals?.totalSales || 0)}</p>
              </div>
              <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Прибуток</p>
                <p style={{ fontSize: "24px", fontWeight: 700, color: "#16A34A" }}>{formatPrice(sales?.totals?.totalProfit || 0)}</p>
              </div>
              <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Документів</p>
                <p style={{ fontSize: "24px", fontWeight: 700 }}>{sales?.totals?.totalDocs || 0}</p>
              </div>
              <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Середня маржа</p>
                <p style={{ fontSize: "24px", fontWeight: 700 }}>{sales?.totals?.avgMargin || 0}%</p>
              </div>
            </div>

            {/* Monthly bar chart */}
            {sales?.monthly?.length > 0 && (
              <div className="bg-white rounded-xl p-6 mb-6" style={{ border: "1px solid #EFEFEF" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px" }}>Продажі по місяцях</h3>
                <div className="flex items-end gap-2" style={{ height: "200px" }}>
                  {sales.monthly.map((m: any) => {
                    const height = (m.sales / maxMonthlySales) * 100;
                    return (
                      <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                        <span style={{ fontSize: "11px", color: "#16A34A", fontWeight: 600 }}>{formatPrice(m.profit)}</span>
                        <div className="w-full flex flex-col items-center">
                          <div
                            style={{ width: "100%", maxWidth: "60px", height: `${height}%`, minHeight: "4px", background: "linear-gradient(to top, #FFD600, #FFC400)", borderRadius: "4px 4px 0 0" }}
                            title={`${formatPrice(m.sales)}`}
                          />
                        </div>
                        <span style={{ fontSize: "11px", color: "#9CA3AF", fontWeight: 500 }}>{m.month.slice(5)}</span>
                        <span style={{ fontSize: "10px", color: "#6B7280" }}>{formatPrice(m.sales)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Two column: brands + reps */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {/* By brand */}
              <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>По брендах</h3>
                {sales?.byBrand?.length > 0 ? (
                  <div className="space-y-3">
                    {sales.byBrand.slice(0, 10).map((b: any) => {
                      const width = sales.byBrand[0].sales > 0 ? (b.sales / sales.byBrand[0].sales) * 100 : 0;
                      return (
                        <div key={b.brand}>
                          <div className="flex justify-between items-center mb-1">
                            <span style={{ fontSize: "14px", fontWeight: 600 }}>{b.brand}</span>
                            <span style={{ fontSize: "13px", color: "#6B7280" }}>{formatPrice(b.sales)} ({b.margin}%)</span>
                          </div>
                          <div style={{ height: "6px", background: "#F3F4F6", borderRadius: "3px" }}>
                            <div style={{ height: "6px", width: `${width}%`, background: "#FFD600", borderRadius: "3px" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <p style={{ color: "#9CA3AF" }}>Немає даних</p>}
              </div>

              {/* By sales rep */}
              <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>По торговим</h3>
                {sales?.byRep?.length > 0 ? (
                  <div className="space-y-3">
                    {sales.byRep.map((r: any) => {
                      const width = sales.byRep[0].sales > 0 ? (r.sales / sales.byRep[0].sales) * 100 : 0;
                      return (
                        <div key={r.id}>
                          <div className="flex justify-between items-center mb-1">
                            <span style={{ fontSize: "14px", fontWeight: 600 }}>{r.name}</span>
                            <span style={{ fontSize: "13px", color: "#6B7280" }}>{formatPrice(r.sales)} | {r.docs} док.</span>
                          </div>
                          <div style={{ height: "6px", background: "#F3F4F6", borderRadius: "3px" }}>
                            <div style={{ height: "6px", width: `${width}%`, background: "#6366F1", borderRadius: "3px" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : <p style={{ color: "#9CA3AF" }}>Немає даних</p>}
              </div>
            </div>

            {/* Top products */}
            {sales?.topProducts?.length > 0 && (
              <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>Топ товари</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: "1px solid #EFEFEF" }}>
                        <th style={{ padding: "8px 0", textAlign: "left", fontSize: "13px", color: "#6B7280" }}>Товар</th>
                        <th style={{ padding: "8px 0", textAlign: "center", fontSize: "13px", color: "#6B7280" }}>Продано</th>
                        <th style={{ padding: "8px 0", textAlign: "right", fontSize: "13px", color: "#6B7280" }}>Виручка</th>
                        <th style={{ padding: "8px 0", textAlign: "right", fontSize: "13px", color: "#6B7280" }}>Прибуток</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sales.topProducts.map((p: any) => (
                        <tr key={p.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "8px 0", fontSize: "14px", maxWidth: "300px" }} className="truncate">{p.name}</td>
                          <td style={{ padding: "8px 0", textAlign: "center", fontSize: "14px" }}>{p.quantity}</td>
                          <td style={{ padding: "8px 0", textAlign: "right", fontSize: "14px" }}>{formatPrice(p.sales)}</td>
                          <td style={{ padding: "8px 0", textAlign: "right", fontSize: "14px", fontWeight: 600, color: "#16A34A" }}>{formatPrice(p.profit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Purchases tab */
          <>
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Загальні закупівлі</p>
                <p style={{ fontSize: "24px", fontWeight: 700 }}>{formatPrice(purchases?.totals?.totalPurchases || 0)}</p>
              </div>
              <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Документів</p>
                <p style={{ fontSize: "24px", fontWeight: 700 }}>{purchases?.totals?.totalDocs || 0}</p>
              </div>
            </div>

            {purchases?.bySupplier?.length > 0 && (
              <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>По постачальниках</h3>
                <div className="space-y-3">
                  {purchases.bySupplier.map((s: any) => {
                    const width = purchases.bySupplier[0].total > 0 ? (s.total / purchases.bySupplier[0].total) * 100 : 0;
                    return (
                      <div key={s.id}>
                        <div className="flex justify-between items-center mb-1">
                          <span style={{ fontSize: "14px", fontWeight: 600 }}>{s.name}</span>
                          <span style={{ fontSize: "13px", color: "#6B7280" }}>{formatPrice(s.total)} | {s.docs} док.</span>
                        </div>
                        <div style={{ height: "6px", background: "#F3F4F6", borderRadius: "3px" }}>
                          <div style={{ height: "6px", width: `${width}%`, background: "#0EA5E9", borderRadius: "3px" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
