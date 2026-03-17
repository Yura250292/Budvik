"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import { formatPrice, formatDate } from "@/lib/utils";

const STOP_STATUS_LABELS: Record<string, string> = {
  PENDING: "Очікує", LOADED: "Завантажено", DELIVERED: "Доставлено", FAILED: "Не доставлено",
};
const STOP_STATUS_COLOR: Record<string, string> = {
  PENDING: "#6B7280", LOADED: "#2563EB", DELIVERED: "#16A34A", FAILED: "#DC2626",
};

export default function DriverPage() {
  const { data: session } = useSession();
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRoute, setExpandedRoute] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const role = (session?.user as any)?.role;

  const fetchRoutes = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/erp/delivery-routes");
    const data = await res.json();
    setRoutes(Array.isArray(data) ? data : []);
    setLoading(false);
    // Auto-expand first active route
    const active = (Array.isArray(data) ? data : []).find((r: any) => r.status === "IN_PROGRESS" || r.status === "PLANNED");
    if (active) setExpandedRoute(active.id);
  }, []);

  useEffect(() => {
    if (["ADMIN", "MANAGER", "DRIVER"].includes(role)) fetchRoutes();
  }, [role, fetchRoutes]);

  const handleDeliverStop = async (stopId: string, salesDocId: string) => {
    setActionLoading(stopId);
    try {
      // Mark stop as delivered
      await fetch(`/api/erp/delivery-routes/stop/${stopId}/deliver`, { method: "POST" });
      // Mark order as delivered
      await fetch(`/api/erp/sales/${salesDocId}/deliver`, { method: "POST" });
      fetchRoutes();
    } catch { alert("Помилка"); }
    setActionLoading(null);
  };

  if (!["ADMIN", "MANAGER", "DRIVER"].includes(role)) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-lg font-bold">Доступ заборонено</p></div>;
  }

  const activeRoutes = routes.filter((r) => r.status === "PLANNED" || r.status === "IN_PROGRESS");
  const completedRoutes = routes.filter((r) => r.status === "COMPLETED");

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Header */}
      <header className="sticky top-0 z-50" style={{
        background: "linear-gradient(to right, #065F46, #059669)",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
      }}>
        <div style={{ height: "2px", background: "linear-gradient(to right, transparent, #34D399, transparent)" }} />
        <div className="max-w-2xl mx-auto flex items-center gap-3" style={{ padding: "14px 16px" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.15)" }}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
            </svg>
          </div>
          <div className="flex-1">
            <h1 style={{ fontSize: "20px", fontWeight: 700, color: "white" }}>Мої маршрути</h1>
            <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)" }}>
              {activeRoutes.length > 0 ? `${activeRoutes.length} активних` : "Немає активних"}
            </p>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4" style={{ paddingTop: "12px", paddingBottom: "100px" }}>
        {loading ? (
          <div className="text-center py-8" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : routes.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "#F3F4F6" }}>
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="#9CA3AF" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
              </svg>
            </div>
            <p style={{ color: "#9CA3AF", fontSize: "15px" }}>Маршрутів поки немає</p>
            <p style={{ color: "#D1D5DB", fontSize: "13px", marginTop: "4px" }}>Менеджер призначить маршрут</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Active routes first */}
            {activeRoutes.map((route) => (
              <div key={route.id} className="bg-white rounded-2xl overflow-hidden"
                style={{ border: "1px solid #EFEFEF", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <button onClick={() => setExpandedRoute(expandedRoute === route.id ? null : route.id)}
                  className="w-full text-left" style={{ padding: "14px 16px" }}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: "16px", fontWeight: 700, color: "#0A0A0A" }}>{route.number}</span>
                      <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "6px",
                        background: "#F0FDF4", color: "#059669" }}>
                        Активний
                      </span>
                    </div>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>{formatDate(route.date)}</span>
                  </div>
                  <div className="flex items-center gap-4" style={{ fontSize: "13px", color: "#6B7280" }}>
                    <span>{route._count?.stops || route.stops?.length || 0} зупинок</span>
                    {route.vehicleInfo && <span>| {route.vehicleInfo}</span>}
                    <span style={{ marginLeft: "auto" }}>
                      {route.stops?.filter((s: any) => s.status === "DELIVERED").length || 0}/{route.stops?.length || 0} доставлено
                    </span>
                  </div>
                </button>

                {expandedRoute === route.id && route.stops && (
                  <div style={{ borderTop: "1px solid #F3F4F6" }}>
                    {route.stops.map((stop: any, idx: number) => (
                      <div key={stop.id} style={{
                        padding: "12px 16px", borderBottom: "1px solid #F9FAFB",
                        background: stop.status === "DELIVERED" ? "#F0FDF4" : "white",
                        opacity: stop.status === "DELIVERED" ? 0.7 : 1,
                      }}>
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{
                              background: stop.status === "DELIVERED" ? "#DCFCE7" : "#EFF6FF",
                              color: stop.status === "DELIVERED" ? "#16A34A" : "#2563EB",
                              fontSize: "13px", fontWeight: 700,
                            }}>
                            {stop.status === "DELIVERED" ? "✓" : idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p style={{ fontSize: "15px", fontWeight: 600, color: "#0A0A0A" }}>
                              {stop.counterparty?.name || "—"}
                            </p>
                            {stop.address && (
                              <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "2px" }}>{stop.address}</p>
                            )}
                            <div className="flex items-center gap-3 mt-1" style={{ fontSize: "12px" }}>
                              <span style={{ color: "#6B7280" }}>{stop.salesDocument?.number}</span>
                              <span style={{ fontWeight: 600 }}>{formatPrice(stop.salesDocument?.totalAmount || 0)}</span>
                              <span style={{ color: STOP_STATUS_COLOR[stop.status], fontWeight: 600 }}>
                                {STOP_STATUS_LABELS[stop.status]}
                              </span>
                            </div>
                          </div>
                        </div>
                        {stop.status !== "DELIVERED" && (
                          <div className="mt-3 flex gap-2">
                            <button onClick={() => handleDeliverStop(stop.id, stop.salesDocument?.id)}
                              disabled={actionLoading === stop.id}
                              style={{
                                flex: 1, padding: "10px", borderRadius: "10px", fontWeight: 700, fontSize: "14px",
                                background: "#16A34A", color: "white", border: "none",
                                opacity: actionLoading === stop.id ? 0.5 : 1,
                              }}>
                              {actionLoading === stop.id ? "..." : "Доставлено"}
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Completed routes */}
            {completedRoutes.length > 0 && (
              <>
                <p style={{ fontSize: "13px", color: "#9CA3AF", fontWeight: 600, marginTop: "16px" }}>ЗАВЕРШЕНІ</p>
                {completedRoutes.map((route) => (
                  <div key={route.id} className="bg-white rounded-2xl p-4" style={{ border: "1px solid #EFEFEF", opacity: 0.7 }}>
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: "15px", fontWeight: 600 }}>{route.number}</span>
                      <span style={{ fontSize: "13px", color: "#6B7280" }}>{formatDate(route.date)} | {route.stops?.length || 0} зупинок</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
