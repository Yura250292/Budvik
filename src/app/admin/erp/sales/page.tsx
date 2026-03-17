"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Створено", CONFIRMED: "Підтверджено", PACKING: "На упакуванні",
  IN_TRANSIT: "В дорозі", DELIVERED: "Доставлено", CANCELLED: "Скасовано",
};
const STATUS_BG: Record<string, string> = {
  DRAFT: "#FFF7ED", CONFIRMED: "#EFF6FF", PACKING: "#FDF4FF",
  IN_TRANSIT: "#FFFBEB", DELIVERED: "#F0FDF4", CANCELLED: "#FEF2F2",
};
const STATUS_COLOR: Record<string, string> = {
  DRAFT: "#D97706", CONFIRMED: "#2563EB", PACKING: "#9333EA",
  IN_TRANSIT: "#D97706", DELIVERED: "#16A34A", CANCELLED: "#DC2626",
};

export default function SalesDocumentsPage() {
  const { data: session } = useSession();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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
    if (["ADMIN", "MANAGER", "SALES"].includes(role)) fetchData();
  }, [role, fetchData]);

  const handleAction = async (docId: string, action: string) => {
    setActionLoading(docId);
    try {
      const res = await fetch(`/api/erp/sales/${docId}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Помилка");
      } else {
        fetchData();
      }
    } catch {
      alert("Мережева помилка");
    }
    setActionLoading(null);
  };

  if (!["ADMIN", "MANAGER", "SALES"].includes(role)) {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  const canConfirm = role === "ADMIN" || role === "MANAGER";

  // Count by status
  const counts: Record<string, number> = {};
  docs.forEach((d) => { counts[d.status] = (counts[d.status] || 0) + 1; });

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
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Замовлення</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Управління замовленнями від торгових</p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {/* Status filters */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {[
            { key: "", label: "Всі" },
            { key: "DRAFT", label: `Нові${counts.DRAFT ? ` (${counts.DRAFT})` : ""}` },
            { key: "CONFIRMED", label: `Підтверджені${counts.CONFIRMED ? ` (${counts.CONFIRMED})` : ""}` },
            { key: "PACKING", label: `Пакування${counts.PACKING ? ` (${counts.PACKING})` : ""}` },
            { key: "IN_TRANSIT", label: `В дорозі${counts.IN_TRANSIT ? ` (${counts.IN_TRANSIT})` : ""}` },
            { key: "DELIVERED", label: `Доставлені${counts.DELIVERED ? ` (${counts.DELIVERED})` : ""}` },
            { key: "CANCELLED", label: "Скасовані" },
          ].map((f) => (
            <button key={f.key} onClick={() => setFilterStatus(f.key)}
              style={{
                padding: "8px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: 500,
                background: filterStatus === f.key ? "#FFD600" : "white",
                border: `1px solid ${filterStatus === f.key ? "#FFD600" : "#E5E7EB"}`,
              }}>
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-12" style={{ color: "#9E9E9E" }}>Завантаження...</div>
        ) : docs.length === 0 ? (
          <div className="text-center py-12"><p style={{ color: "#9E9E9E" }}>Замовлень не знайдено</p></div>
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
                    <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Статус</th>
                    <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Дата</th>
                    {canConfirm && <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Дія</th>}
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
                      <td style={{ padding: "14px 16px", textAlign: "center" }}>
                        <span style={{
                          padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
                          background: STATUS_BG[d.status], color: STATUS_COLOR[d.status],
                        }}>
                          {STATUS_LABELS[d.status]}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px", fontSize: "13px", color: "#6B7280" }}>
                        {formatDate(d.createdAt)}
                      </td>
                      {canConfirm && (
                        <td style={{ padding: "14px 8px", textAlign: "center" }}>
                          <div className="flex gap-1 justify-center">
                            {d.status === "DRAFT" && (
                              <>
                                <button onClick={() => handleAction(d.id, "confirm")}
                                  disabled={actionLoading === d.id}
                                  style={{
                                    padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
                                    background: "#16A34A", color: "white", border: "none", opacity: actionLoading === d.id ? 0.5 : 1,
                                  }}>
                                  Підтвердити
                                </button>
                                <button onClick={() => handleAction(d.id, "cancel")}
                                  disabled={actionLoading === d.id}
                                  style={{
                                    padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
                                    background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA",
                                    opacity: actionLoading === d.id ? 0.5 : 1,
                                  }}>
                                  Відхилити
                                </button>
                              </>
                            )}
                            {d.status === "CONFIRMED" && (
                              <span style={{ fontSize: "11px", color: "#9CA3AF" }}>Очікує маршрут</span>
                            )}
                            {d.status === "PACKING" && (
                              <span style={{ fontSize: "11px", color: "#9333EA" }}>Упаковується</span>
                            )}
                            {d.status === "IN_TRANSIT" && (
                              <span style={{ fontSize: "11px", color: "#D97706" }}>Їде</span>
                            )}
                          </div>
                        </td>
                      )}
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
