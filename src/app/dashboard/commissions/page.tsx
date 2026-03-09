"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = { PENDING: "Очікує", APPROVED: "Затверджено", PAID: "Виплачено" };
const STATUS_COLORS: Record<string, string> = { PENDING: "bg-primary/10 text-primary-dark", APPROVED: "bg-blue-50 text-blue-700", PAID: "bg-green-50 text-green-700" };

export default function MyCommissionsPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const role = (session?.user as any)?.role;

  const fetchData = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    const res = await fetch(`/api/erp/commissions/my?${params}`);
    const result = await res.json();
    setData(result);
    setLoading(false);
  };

  useEffect(() => {
    if (role === "SALES" || role === "ADMIN") fetchData();
  }, [role]);

  if (role !== "SALES" && role !== "ADMIN") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  const summary = data?.summary || {};
  const records = data?.records || [];

  // Group by brand for breakdown
  const brandBreakdown = new Map<string, { sales: number; profit: number; commission: number }>();
  for (const r of records) {
    const existing = brandBreakdown.get(r.brand) || { sales: 0, profit: 0, commission: 0 };
    existing.sales += r.saleAmount;
    existing.profit += r.profitAmount;
    existing.commission += r.commissionAmount;
    brandBreakdown.set(r.brand, existing);
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Link href="/dashboard" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
            <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Мої комісії</h1>
            <p style={{ fontSize: "14px", color: "#6B7280" }}>{session?.user?.name}</p>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {/* Date filter */}
        <div className="flex gap-3 mb-6 items-end">
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
            Фільтрувати
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12" style={{ color: "#9E9E9E" }}>Завантаження...</div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Загальні продажі</p>
                <p style={{ fontSize: "22px", fontWeight: 700 }}>{formatPrice(summary.totalSales || 0)}</p>
              </div>
              <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Згенерований прибуток</p>
                <p style={{ fontSize: "22px", fontWeight: 700, color: "#16A34A" }}>{formatPrice(summary.totalProfit || 0)}</p>
              </div>
              <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Зароблена комісія</p>
                <p style={{ fontSize: "22px", fontWeight: 700, color: "#F59E0B" }}>{formatPrice(summary.totalCommission || 0)}</p>
              </div>
              <div className="bg-white rounded-xl p-4" style={{ border: "1px solid #EFEFEF" }}>
                <p style={{ fontSize: "13px", color: "#6B7280" }}>Виплачено</p>
                <p style={{ fontSize: "22px", fontWeight: 700, color: "#22C55E" }}>{formatPrice(summary.paidCommission || 0)}</p>
              </div>
            </div>

            {/* Brand breakdown */}
            {brandBreakdown.size > 0 && (
              <div className="bg-white rounded-xl p-6 mb-6" style={{ border: "1px solid #EFEFEF" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>По брендах</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Array.from(brandBreakdown.entries())
                    .sort((a, b) => b[1].commission - a[1].commission)
                    .map(([brand, data]) => (
                      <div key={brand} className="p-3 rounded-lg" style={{ background: "#FAFAFA" }}>
                        <p style={{ fontSize: "13px", fontWeight: 600, color: "#0A0A0A" }}>{brand}</p>
                        <p style={{ fontSize: "12px", color: "#6B7280" }}>Продажі: {formatPrice(data.sales)}</p>
                        <p style={{ fontSize: "14px", fontWeight: 700, color: "#F59E0B", marginTop: "4px" }}>{formatPrice(data.commission)}</p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Records table */}
            {records.length === 0 ? (
              <div className="text-center py-12"><p style={{ color: "#9E9E9E" }}>Комісій за цей період немає</p></div>
            ) : (
              <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF" }}>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ background: "#FAFAFA", borderBottom: "1px solid #EFEFEF" }}>
                        <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Документ</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Покупець</th>
                        <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Бренд</th>
                        <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Продаж</th>
                        <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Прибуток</th>
                        <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Комісія</th>
                        <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Статус</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r: any) => (
                        <tr key={r.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "14px 16px", fontSize: "14px", fontWeight: 500 }}>{r.salesDocument?.number}</td>
                          <td style={{ padding: "14px 16px", fontSize: "14px", color: "#6B7280" }}>{r.salesDocument?.counterparty?.name || "—"}</td>
                          <td style={{ padding: "14px 16px", fontSize: "14px", fontWeight: 500 }}>{r.brand}</td>
                          <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "14px" }}>{formatPrice(r.saleAmount)}</td>
                          <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "14px", color: "#16A34A" }}>{formatPrice(r.profitAmount)}</td>
                          <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "14px", fontWeight: 700, color: "#F59E0B" }}>{formatPrice(r.commissionAmount)}</td>
                          <td style={{ padding: "14px 16px", textAlign: "center" }}>
                            <span className={`px-2 py-1 rounded-md text-xs font-medium ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
