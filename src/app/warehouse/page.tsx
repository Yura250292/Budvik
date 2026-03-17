"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import { formatPrice, formatDate } from "@/lib/utils";

const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: "Підтверджено", PACKING: "На упакуванні", IN_TRANSIT: "Відправлено",
};
const STATUS_BG: Record<string, string> = {
  CONFIRMED: "#EFF6FF", PACKING: "#FDF4FF", IN_TRANSIT: "#FFFBEB",
};
const STATUS_COLOR: Record<string, string> = {
  CONFIRMED: "#2563EB", PACKING: "#9333EA", IN_TRANSIT: "#D97706",
};

export default function WarehousePage() {
  const { data: session } = useSession();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("CONFIRMED");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const role = (session?.user as any)?.role;

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter) params.set("status", filter);
    const res = await fetch(`/api/erp/sales?${params}`);
    const data = await res.json();
    setOrders(Array.isArray(data) ? data : []);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    if (["ADMIN", "MANAGER", "WAREHOUSE"].includes(role)) fetchOrders();
  }, [role, fetchOrders]);

  const handleAction = async (docId: string, action: string) => {
    setActionLoading(docId);
    try {
      const res = await fetch(`/api/erp/sales/${docId}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) alert(data.error || "Помилка");
      else fetchOrders();
    } catch { alert("Мережева помилка"); }
    setActionLoading(null);
  };

  // Fetch order details when expanding
  const [orderDetails, setOrderDetails] = useState<Record<string, any>>({});
  const loadDetails = async (orderId: string) => {
    if (orderDetails[orderId]) return;
    const res = await fetch(`/api/erp/sales/${orderId}`);
    const data = await res.json();
    setOrderDetails((prev) => ({ ...prev, [orderId]: data }));
  };

  const toggleExpand = (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    loadDetails(id);
  };

  if (!["ADMIN", "MANAGER", "WAREHOUSE"].includes(role)) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-lg font-bold">Доступ заборонено</p></div>;
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Header */}
      <header className="sticky top-0 z-50" style={{
        background: "linear-gradient(to right, #1E3A5F, #2563EB)",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
      }}>
        <div style={{ height: "2px", background: "linear-gradient(to right, transparent, #60A5FA, transparent)" }} />
        <div className="max-w-2xl mx-auto flex items-center gap-3" style={{ padding: "14px 16px" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
          </div>
          <div className="flex-1">
            <h1 style={{ fontSize: "20px", fontWeight: 700, color: "white" }}>Склад</h1>
            <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)" }}>Замовлення на збірку</p>
          </div>
          <span style={{ fontSize: "14px", color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>
            {orders.length} зам.
          </span>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4" style={{ paddingTop: "12px", paddingBottom: "100px" }}>
        {/* Filters */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {[
            { key: "CONFIRMED", label: "До збірки" },
            { key: "PACKING", label: "Пакую" },
            { key: "IN_TRANSIT", label: "Відправлено" },
          ].map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              style={{
                padding: "8px 16px", borderRadius: "12px", fontSize: "13px", fontWeight: 600,
                whiteSpace: "nowrap", border: "none",
                background: filter === f.key ? "#2563EB" : "white",
                color: filter === f.key ? "white" : "#6B7280",
                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              }}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Orders list */}
        {loading ? (
          <div className="text-center py-8" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "#F3F4F6" }}>
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="#9CA3AF" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p style={{ color: "#9CA3AF", fontSize: "15px" }}>Замовлень немає</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((o) => (
              <div key={o.id} className="bg-white rounded-2xl overflow-hidden"
                style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                {/* Order header — clickable */}
                <button onClick={() => toggleExpand(o.id)} className="w-full text-left" style={{ padding: "14px 16px" }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: "15px", fontWeight: 700, color: "#0A0A0A" }}>{o.number}</span>
                      <span style={{
                        fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "6px",
                        background: STATUS_BG[o.status], color: STATUS_COLOR[o.status],
                      }}>
                        {STATUS_LABELS[o.status]}
                      </span>
                    </div>
                    <svg className={`w-4 h-4 transition-transform ${expandedId === o.id ? "rotate-180" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="#9CA3AF" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p style={{ fontSize: "14px", fontWeight: 500, color: "#0A0A0A" }}>{o.counterparty?.name || "—"}</p>
                      <p style={{ fontSize: "12px", color: "#9CA3AF" }}>
                        Торговий: {o.salesRep?.name || "—"} | {formatDate(o.createdAt)}
                      </p>
                      {o.deliveryMethod && (
                        <p style={{ fontSize: "12px", color: "#6B7280", marginTop: "2px" }}>
                          {o.deliveryMethod === "DRIVER" ? "Доставка водієм" :
                           o.deliveryMethod === "SALES_REP_PICKUP" ? "Забере торговий" : "Самовивіз"}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p style={{ fontSize: "18px", fontWeight: 700, color: "#0A0A0A" }}>{formatPrice(o.totalAmount)}</p>
                      <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{o._count?.items || 0} позицій</p>
                    </div>
                  </div>
                </button>

                {/* Expanded: items */}
                {expandedId === o.id && (
                  <div style={{ borderTop: "1px solid #F3F4F6" }}>
                    {orderDetails[o.id]?.items ? (
                      <div>
                        {orderDetails[o.id].items.map((item: any) => (
                          <div key={item.id} className="flex items-center gap-3"
                            style={{ padding: "10px 16px", borderBottom: "1px solid #F9FAFB" }}>
                            <div className="w-10 h-10 rounded-lg flex-shrink-0 overflow-hidden" style={{ background: "#F3F4F6" }}>
                              {item.product?.image ? (
                                <img src={item.product.image} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="#D1D5DB" strokeWidth={1.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                                  </svg>
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p style={{ fontSize: "14px", fontWeight: 500 }} className="truncate">{item.product?.name}</p>
                              <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{item.product?.sku}</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p style={{ fontSize: "18px", fontWeight: 700, color: "#0A0A0A" }}>{item.quantity} шт.</p>
                            </div>
                          </div>
                        ))}

                        {orderDetails[o.id].notes && (
                          <div style={{ padding: "10px 16px", background: "#FFFBEB" }}>
                            <p style={{ fontSize: "13px", color: "#92400E" }}>Коментар: {orderDetails[o.id].notes}</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ padding: "16px", textAlign: "center", color: "#9CA3AF", fontSize: "13px" }}>Завантаження...</div>
                    )}

                    {/* Action buttons */}
                    <div style={{ padding: "12px 16px", background: "#FAFAFA", borderTop: "1px solid #F3F4F6" }}>
                      {o.status === "CONFIRMED" && (
                        <button onClick={() => handleAction(o.id, "pack")}
                          disabled={actionLoading === o.id}
                          className="w-full"
                          style={{
                            background: "#9333EA", color: "white", padding: "12px", borderRadius: "12px",
                            fontWeight: 700, fontSize: "15px", border: "none",
                            opacity: actionLoading === o.id ? 0.5 : 1,
                          }}>
                          {actionLoading === o.id ? "..." : "Взяти на упакування"}
                        </button>
                      )}
                      {o.status === "PACKING" && (
                        <button onClick={() => handleAction(o.id, "dispatch")}
                          disabled={actionLoading === o.id}
                          className="w-full"
                          style={{
                            background: "#D97706", color: "white", padding: "12px", borderRadius: "12px",
                            fontWeight: 700, fontSize: "15px", border: "none",
                            opacity: actionLoading === o.id ? 0.5 : 1,
                          }}>
                          {actionLoading === o.id ? "..." : "Упаковано — відправити"}
                        </button>
                      )}
                    </div>
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
