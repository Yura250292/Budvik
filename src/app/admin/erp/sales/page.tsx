"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Чернетка",
  CONFIRMED: "Підтверджено",
  CANCELLED: "Скасовано",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  CONFIRMED: "bg-green-50 text-green-700",
  CANCELLED: "bg-red-50 text-red-600",
};

export default function SalesDocumentsPage() {
  const { data: session } = useSession();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");

  const role = (session?.user as any)?.role;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterStatus) params.set("status", filterStatus);
    const res = await fetch(`/api/erp/sales?${params}`);
    const data = await res.json();
    setDocs(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [filterStatus]);

  useEffect(() => {
    if (role === "ADMIN" || role === "SALES") fetchData();
  }, [role, fetchData]);

  if (role !== "ADMIN" && role !== "SALES") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

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
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Продаж</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Документи продажу B2B/оффлайн</p>
            </div>
          </div>
          <Link
            href="/admin/erp/sales/new"
            style={{ background: "#FFD600", color: "#0A0A0A", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", textDecoration: "none" }}
          >
            + Новий продаж
          </Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        <div className="flex gap-3 mb-6">
          {["", "DRAFT", "CONFIRMED", "CANCELLED"].map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: 500,
                background: filterStatus === s ? "#FFD600" : "white",
                border: `1px solid ${filterStatus === s ? "#FFD600" : "#E5E7EB"}`,
              }}
            >
              {s === "" ? "Всі" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12" style={{ color: "#9E9E9E" }}>Завантаження...</div>
        ) : docs.length === 0 ? (
          <div className="text-center py-12"><p style={{ color: "#9E9E9E" }}>Документів не знайдено</p></div>
        ) : (
          <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF", boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ background: "#FAFAFA", borderBottom: "1px solid #EFEFEF" }}>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Номер</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Покупець</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Торговий</th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Позицій</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Сума</th>
                    <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Прибуток</th>
                    <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Статус</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id} className="hover:bg-gray-50 transition-colors" style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "14px 16px" }}>
                        <Link href={`/admin/erp/sales/${d.id}`} className="text-blue-600 hover:text-blue-800 font-semibold text-sm">
                          {d.number}
                        </Link>
                      </td>
                      <td style={{ padding: "14px 16px", fontSize: "14px", fontWeight: 500, color: "#0A0A0A" }}>
                        {d.counterparty?.name || "—"}
                      </td>
                      <td style={{ padding: "14px 16px", fontSize: "14px", color: "#6B7280" }}>
                        {d.salesRep?.name || "—"}
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "center", fontSize: "14px", color: "#6B7280" }}>
                        {d._count?.items}
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "14px", fontWeight: 600 }}>
                        {formatPrice(d.totalAmount)}
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "14px", fontWeight: 600, color: d.profitAmount > 0 ? "#16A34A" : "#DC2626" }}>
                        {d.status === "CONFIRMED" ? formatPrice(d.profitAmount) : "—"}
                      </td>
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <span className={`px-2 py-1 rounded-md text-xs font-medium ${STATUS_COLORS[d.status]}`}>
                          {STATUS_LABELS[d.status]}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px", fontSize: "13px", color: "#6B7280" }}>
                        {formatDate(d.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
