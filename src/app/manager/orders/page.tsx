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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDoc, setExpandedDoc] = useState<any>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);

  // Route assignment state (per doc)
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [plannedRoutes, setPlannedRoutes] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [routeMode, setRouteMode] = useState<"existing" | "new">("existing");
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const [newDate, setNewDate] = useState(new Date().toISOString().split("T")[0]);
  const [newDriverId, setNewDriverId] = useState("");
  const [newVehicle, setNewVehicle] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

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

  const toggleExpand = async (doc: any) => {
    if (expandedId === doc.id) {
      setExpandedId(null);
      setExpandedDoc(null);
      setConfirmingId(null);
      return;
    }
    setExpandedId(doc.id);
    setConfirmingId(null);
    setExpandedLoading(true);
    try {
      const res = await fetch(`/api/erp/sales/${doc.id}`);
      setExpandedDoc(await res.json());
    } catch {
      setExpandedDoc(null);
    }
    setExpandedLoading(false);
  };

  const openRouteStep = async (docId: string) => {
    setConfirmingId(docId);
    setRouteMode("existing");
    setSelectedRouteId("");
    const [routesRes, usersRes] = await Promise.all([
      fetch("/api/erp/delivery-routes?status=PLANNED"),
      fetch("/api/admin/users"),
    ]);
    const routes = await routesRes.json();
    const users = await usersRes.json();
    setPlannedRoutes(Array.isArray(routes) ? routes : []);
    setDrivers(Array.isArray(users) ? users.filter((u: any) => u.role === "DRIVER") : []);
  };

  const handleReject = async (docId: string) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/erp/sales/${docId}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) alert(data.error || "Помилка");
      else { fetchData(); setExpandedId(null); }
    } catch { alert("Мережева помилка"); }
    setActionLoading(false);
  };

  const handleConfirmWithRoute = async (docId: string) => {
    setActionLoading(true);
    try {
      // Step 1: confirm the order
      const confirmRes = await fetch(`/api/erp/sales/${docId}/confirm`, { method: "POST" });
      if (!confirmRes.ok) {
        const d = await confirmRes.json();
        alert(d.error || "Помилка підтвердження");
        setActionLoading(false);
        return;
      }

      // Step 2: add to route
      if (routeMode === "existing" && selectedRouteId) {
        const addRes = await fetch(`/api/erp/delivery-routes/${selectedRouteId}/add-stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ salesDocumentId: docId }),
        });
        if (!addRes.ok) {
          const d = await addRes.json();
          alert("Підтверджено, але помилка маршруту: " + (d.error || "невідома"));
        }
      } else if (routeMode === "new") {
        const createRes = await fetch("/api/erp/delivery-routes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            driverId: newDriverId || null,
            date: newDate,
            vehicleInfo: newVehicle || null,
            salesDocumentIds: [docId],
          }),
        });
        if (!createRes.ok) {
          const d = await createRes.json();
          alert("Підтверджено, але помилка маршруту: " + (d.error || "невідома"));
        }
      }

      fetchData();
      setExpandedId(null);
      setConfirmingId(null);
    } catch { alert("Мережева помилка"); }
    setActionLoading(false);
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
          <div className="text-center py-16" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : docs.length === 0 ? (
          <div className="text-center py-16">
            <p style={{ fontSize: "16px", fontWeight: 500, color: "#6B7280" }}>Замовлень не знайдено</p>
          </div>
        ) : (
          <div className="space-y-3">
            {docs.map((doc) => (
              <div key={doc.id} className="bg-white rounded-2xl overflow-hidden"
                style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>

                {/* Header row */}
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
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p style={{ fontSize: "16px", fontWeight: 700, color: "#0A0A0A" }}>{formatPrice(doc.totalAmount)}</p>
                      <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{formatDate(doc.createdAt)}</p>
                    </div>
                  </div>
                </button>

                {/* Expanded */}
                {expandedId === doc.id && (
                  <div style={{ borderTop: "1px solid #F3F4F6" }}>
                    {expandedLoading ? (
                      <div className="text-center py-4" style={{ color: "#9CA3AF", fontSize: "14px" }}>Завантаження...</div>
                    ) : expandedDoc ? (
                      <>
                        {/* Items */}
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

                        {/* Route assignment step (DRAFT only) */}
                        {doc.status === "DRAFT" && confirmingId === doc.id && (
                          <div style={{ padding: "16px", background: "#F0FDF4", borderTop: "1px solid #DCFCE7" }}>
                            <p style={{ fontSize: "13px", fontWeight: 700, color: "#15803D", marginBottom: "12px" }}>
                              Крок 2 з 2 — Призначити дорожній лист
                            </p>

                            {/* Mode toggle */}
                            <div className="flex gap-2 mb-3">
                              <button onClick={() => setRouteMode("existing")}
                                style={{
                                  flex: 1, padding: "9px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                                  background: routeMode === "existing" ? "#16A34A" : "white",
                                  color: routeMode === "existing" ? "white" : "#6B7280",
                                  border: `1px solid ${routeMode === "existing" ? "#16A34A" : "#E5E7EB"}`,
                                }}>
                                Існуючий маршрут
                              </button>
                              <button onClick={() => setRouteMode("new")}
                                style={{
                                  flex: 1, padding: "9px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                                  background: routeMode === "new" ? "#16A34A" : "white",
                                  color: routeMode === "new" ? "white" : "#6B7280",
                                  border: `1px solid ${routeMode === "new" ? "#16A34A" : "#E5E7EB"}`,
                                }}>
                                Новий маршрут
                              </button>
                            </div>

                            {routeMode === "existing" && (
                              plannedRoutes.length === 0 ? (
                                <p style={{ fontSize: "13px", color: "#6B7280", marginBottom: "8px", textAlign: "center" }}>
                                  Немає запланованих маршрутів. Оберіть "Новий маршрут".
                                </p>
                              ) : (
                                <select value={selectedRouteId} onChange={(e) => setSelectedRouteId(e.target.value)}
                                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px", background: "white", marginBottom: "8px" }}>
                                  <option value="">— Оберіть маршрут —</option>
                                  {plannedRoutes.map((r) => (
                                    <option key={r.id} value={r.id}>
                                      {r.number} · {r.driver?.name || "Без водія"} · {new Date(r.date).toLocaleDateString("uk-UA")} ({r._count?.stops || 0} зуп.)
                                    </option>
                                  ))}
                                </select>
                              )
                            )}

                            {routeMode === "new" && (
                              <div className="grid grid-cols-2 gap-2 mb-2">
                                <div>
                                  <label style={{ fontSize: "11px", color: "#6B7280", display: "block", marginBottom: "3px" }}>Дата</label>
                                  <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
                                    style={{ width: "100%", padding: "9px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px" }} />
                                </div>
                                <div>
                                  <label style={{ fontSize: "11px", color: "#6B7280", display: "block", marginBottom: "3px" }}>Водій</label>
                                  <select value={newDriverId} onChange={(e) => setNewDriverId(e.target.value)}
                                    style={{ width: "100%", padding: "9px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px", background: "white" }}>
                                    <option value="">— Не обрано —</option>
                                    {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                                  </select>
                                </div>
                                <div className="col-span-2">
                                  <label style={{ fontSize: "11px", color: "#6B7280", display: "block", marginBottom: "3px" }}>Авто</label>
                                  <input value={newVehicle} onChange={(e) => setNewVehicle(e.target.value)}
                                    placeholder="Renault Kangoo AA1234BB"
                                    style={{ width: "100%", padding: "9px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px" }} />
                                </div>
                              </div>
                            )}

                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => handleConfirmWithRoute(doc.id)}
                                disabled={actionLoading || (routeMode === "existing" && !selectedRouteId && plannedRoutes.length > 0)}
                                style={{
                                  flex: 1, padding: "12px", borderRadius: "10px", fontSize: "14px", fontWeight: 700,
                                  background: "#16A34A", color: "white", border: "none",
                                  opacity: actionLoading ? 0.6 : 1,
                                }}>
                                {actionLoading ? "Підтверджую..." : "Підтвердити та додати до маршруту"}
                              </button>
                              <button onClick={() => setConfirmingId(null)}
                                style={{
                                  padding: "12px 14px", borderRadius: "10px", fontSize: "13px",
                                  border: "1px solid #E5E7EB", background: "white",
                                }}>
                                ←
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Actions bar */}
                        {!(doc.status === "DRAFT" && confirmingId === doc.id) && (
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
                                    onClick={() => openRouteStep(doc.id)}
                                    style={{
                                      padding: "10px 20px", borderRadius: "10px", fontSize: "13px", fontWeight: 700,
                                      background: "#16A34A", color: "white", border: "none",
                                    }}>
                                    Підтвердити →
                                  </button>
                                  <button
                                    onClick={() => handleReject(doc.id)}
                                    disabled={actionLoading}
                                    style={{
                                      padding: "10px 16px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                                      background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA",
                                      opacity: actionLoading ? 0.6 : 1,
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
                                  До маршруту →
                                </Link>
                              )}
                            </div>
                          </div>
                        )}
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
