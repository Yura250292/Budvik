"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Нове", CONFIRMED: "Підтверджено", PACKING: "Пакування",
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

function OrdersContent() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState(searchParams.get("status") || "DRAFT");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDoc, setExpandedDoc] = useState<any>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);

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
    if (role === "ADMIN" || role === "MANAGER") fetchData();
  }, [role, fetchData]);

  const handleAction = async (docId: string, action: string) => {
    setActionLoading(docId);
    try {
      const res = await fetch(`/api/erp/sales/${docId}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) alert(data.error || "Помилка");
      else {
        fetchData();
        if (expandedId === docId) setExpandedId(null);
      }
    } catch {
      alert("Мережева помилка");
    }
    setActionLoading(null);
  };

  const toggleExpand = async (doc: any) => {
    if (expandedId === doc.id) {
      setExpandedId(null);
      setExpandedDoc(null);
      return;
    }
    setExpandedId(doc.id);
    setExpandedLoading(true);
    try {
      const res = await fetch(`/api/erp/sales/${doc.id}`);
      const data = await res.json();
      setExpandedDoc(data);
    } catch {
      setExpandedDoc(null);
    }
    setExpandedLoading(false);
  };

  if (role !== "ADMIN" && role !== "MANAGER") {
    return <div className="p-8 text-center font-bold">Доступ заборонено</div>;
  }

  const FILTERS = [
    { key: "DRAFT", label: "Нові", color: "#D97706" },
    { key: "CONFIRMED", label: "Підтверджені", color: "#2563EB" },
    { key: "PACKING", label: "Пакування", color: "#9333EA" },
    { key: "IN_TRANSIT", label: "В дорозі", color: "#D97706" },
    { key: "DELIVERED", label: "Доставлені", color: "#16A34A" },
    { key: "", label: "Всі", color: "#6B7280" },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF" }}>
        <div className="max-w-2xl mx-auto flex items-center gap-3" style={{ padding: "14px 16px" }}>
          <Link href="/manager" className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "#FFD600" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#0A0A0A", lineHeight: 1.2 }}>Замовлення</h1>
            <p style={{ fontSize: "13px", color: "#6B7280" }}>від торгових представників</p>
          </div>
        </div>

        {/* Status filter tabs */}
        <div className="overflow-x-auto" style={{ borderTop: "1px solid #F3F4F6" }}>
          <div className="flex gap-1 px-4 py-2" style={{ minWidth: "max-content" }}>
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilterStatus(f.key)}
                style={{
                  padding: "7px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 500,
                  background: filterStatus === f.key ? f.color : "transparent",
                  color: filterStatus === f.key ? "white" : "#6B7280",
                  border: "none", whiteSpace: "nowrap",
                }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4" style={{ paddingTop: "16px", paddingBottom: "40px" }}>
        {loading ? (
          <div className="text-center py-16" style={{ color: "#9CA3AF" }}>
            <svg className="w-8 h-8 mx-auto mb-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Завантаження...
          </div>
        ) : docs.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "#F3F4F6" }}>
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="#9CA3AF" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p style={{ fontSize: "16px", fontWeight: 500, color: "#6B7280" }}>Замовлень не знайдено</p>
          </div>
        ) : (
          <div className="space-y-3">
            {docs.map((doc) => (
              <div key={doc.id} className="bg-white rounded-2xl overflow-hidden"
                style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>

                {/* Main row */}
                <button onClick={() => toggleExpand(doc)} className="w-full text-left" style={{ padding: "16px", display: "block" }}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span style={{ fontSize: "15px", fontWeight: 700, color: "#0A0A0A" }}>
                          {doc.counterparty?.name || "—"}
                        </span>
                        <span style={{
                          fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "6px",
                          background: STATUS_BG[doc.status], color: STATUS_COLOR[doc.status], flexShrink: 0,
                        }}>
                          {STATUS_LABELS[doc.status]}
                        </span>
                      </div>
                      <p style={{ fontSize: "13px", color: "#9CA3AF" }}>
                        {doc.number} · {doc.salesRep?.name || "—"} · {doc._count?.items || 0} поз.
                      </p>
                      {doc.note && (
                        <p style={{ fontSize: "12px", color: "#6B7280", marginTop: "4px", fontStyle: "italic" }}>
                          {doc.note}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p style={{ fontSize: "16px", fontWeight: 700, color: "#0A0A0A" }}>{formatPrice(doc.totalAmount)}</p>
                      <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{formatDate(doc.createdAt)}</p>
                    </div>
                  </div>
                </button>

                {/* Expanded details */}
                {expandedId === doc.id && (
                  <div style={{ borderTop: "1px solid #F3F4F6" }}>
                    {expandedLoading ? (
                      <div className="text-center py-4" style={{ color: "#9CA3AF", fontSize: "14px" }}>Завантаження...</div>
                    ) : expandedDoc ? (
                      <>
                        {/* Items list */}
                        <div style={{ padding: "12px 16px" }}>
                          <p style={{ fontSize: "12px", fontWeight: 600, color: "#9CA3AF", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                            Позиції накладної
                          </p>
                          <div className="space-y-2">
                            {expandedDoc.items?.map((item: any) => (
                              <div key={item.id} className="flex items-center gap-3">
                                <div className="flex-1 min-w-0">
                                  <p style={{ fontSize: "13px", fontWeight: 500, color: "#0A0A0A" }}>{item.product?.name || "—"}</p>
                                  <p style={{ fontSize: "12px", color: "#9CA3AF" }}>
                                    {item.quantity} шт × {formatPrice(item.sellingPrice)}
                                  </p>
                                </div>
                                <p style={{ fontSize: "13px", fontWeight: 600, color: "#0A0A0A", flexShrink: 0 }}>
                                  {formatPrice(item.quantity * item.sellingPrice)}
                                </p>
                              </div>
                            ))}
                          </div>
                          <div className="flex justify-between mt-3 pt-3" style={{ borderTop: "1px solid #F3F4F6" }}>
                            <span style={{ fontSize: "14px", fontWeight: 600, color: "#6B7280" }}>Разом</span>
                            <span style={{ fontSize: "16px", fontWeight: 700, color: "#0A0A0A" }}>
                              {formatPrice(expandedDoc.totalAmount)}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div style={{ padding: "12px 16px", background: "#FAFAFA", borderTop: "1px solid #F3F4F6" }}>
                          <div className="flex gap-2 flex-wrap">
                            <Link href={`/admin/erp/sales/${doc.id}`}
                              style={{
                                padding: "10px 16px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                                background: "#F3F4F6", color: "#374151", textDecoration: "none",
                              }}>
                              Відкрити повністю
                            </Link>
                            {doc.status === "DRAFT" && (
                              <>
                                <button
                                  onClick={() => handleAction(doc.id, "confirm")}
                                  disabled={actionLoading === doc.id}
                                  style={{
                                    padding: "10px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
                                    background: "#16A34A", color: "white", border: "none",
                                    opacity: actionLoading === doc.id ? 0.6 : 1,
                                  }}>
                                  {actionLoading === doc.id ? "..." : "Підтвердити"}
                                </button>
                                <button
                                  onClick={() => handleAction(doc.id, "cancel")}
                                  disabled={actionLoading === doc.id}
                                  style={{
                                    padding: "10px 16px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                                    background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA",
                                    opacity: actionLoading === doc.id ? 0.6 : 1,
                                  }}>
                                  Відхилити
                                </button>
                              </>
                            )}
                            {doc.status === "CONFIRMED" && (
                              <Link href="/manager/routes"
                                style={{
                                  padding: "10px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
                                  background: "#F59E0B", color: "white", textDecoration: "none",
                                }}>
                                Додати до маршруту →
                              </Link>
                            )}
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ManagerOrdersPage() {
  return (
    <Suspense>
      <OrdersContent />
    </Suspense>
  );
}
