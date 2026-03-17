"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

const ROUTE_STATUS_LABELS: Record<string, string> = {
  PLANNED: "Запланований", IN_PROGRESS: "В дорозі", COMPLETED: "Завершений", CANCELLED: "Скасований",
};
const ROUTE_STATUS_COLOR: Record<string, string> = {
  PLANNED: "#2563EB", IN_PROGRESS: "#D97706", COMPLETED: "#16A34A", CANCELLED: "#DC2626",
};
const ROUTE_STATUS_BG: Record<string, string> = {
  PLANNED: "#EFF6FF", IN_PROGRESS: "#FFFBEB", COMPLETED: "#F0FDF4", CANCELLED: "#FEF2F2",
};

export default function DeliveryRoutesPage() {
  const { data: session } = useSession();
  const [routes, setRoutes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [confirmedOrders, setConfirmedOrders] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Create form
  const [formDriverId, setFormDriverId] = useState("");
  const [formDate, setFormDate] = useState(new Date().toISOString().split("T")[0]);
  const [formVehicle, setFormVehicle] = useState("");
  const [formFuelConsumption, setFormFuelConsumption] = useState("");
  const [formFuelPrice, setFormFuelPrice] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);

  const role = (session?.user as any)?.role;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [routesRes, ordersRes, usersRes] = await Promise.all([
      fetch("/api/erp/delivery-routes"),
      fetch("/api/erp/sales?status=CONFIRMED"),
      fetch("/api/admin/users"),
    ]);
    const routesData = await routesRes.json();
    const ordersData = await ordersRes.json();
    const usersData = await usersRes.json();

    setRoutes(Array.isArray(routesData) ? routesData : []);
    setConfirmedOrders(Array.isArray(ordersData) ? ordersData : []);
    setDrivers(Array.isArray(usersData) ? usersData.filter((u: any) => u.role === "DRIVER") : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (["ADMIN", "MANAGER"].includes(role)) fetchData();
  }, [role, fetchData]);

  const toggleOrder = (id: string) => {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleCreate = async () => {
    if (selectedOrderIds.length === 0) { alert("Оберіть замовлення"); return; }
    setActionLoading(true);
    try {
      const res = await fetch("/api/erp/delivery-routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: formDriverId || null,
          date: formDate,
          vehicleInfo: formVehicle || null,
          fuelConsumption: formFuelConsumption ? parseFloat(formFuelConsumption) : null,
          fuelPricePer: formFuelPrice ? parseFloat(formFuelPrice) : null,
          notes: formNotes || null,
          salesDocumentIds: selectedOrderIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Помилка"); }
      else {
        setShowCreate(false);
        setSelectedOrderIds([]);
        setFormDriverId(""); setFormVehicle(""); setFormNotes("");
        fetchData();
      }
    } catch { alert("Мережева помилка"); }
    setActionLoading(false);
  };

  if (!["ADMIN", "MANAGER"].includes(role)) {
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
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Маршрути доставки</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Шляхові листи для водіїв</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/admin/erp/route-planner"
              style={{ background: "linear-gradient(135deg, #8B5CF6, #6366F1)", color: "white", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", textDecoration: "none" }}>
              Планувальник маршрутів
            </Link>
            <button onClick={() => setShowCreate(true)}
              style={{ background: "#FFD600", color: "#0A0A0A", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", border: "none" }}>
              + Новий маршрут
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {loading ? (
          <div className="text-center py-12" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : routes.length === 0 && !showCreate ? (
          <div className="text-center py-12"><p style={{ color: "#9CA3AF" }}>Маршрутів ще немає</p></div>
        ) : null}

        {/* Create form */}
        {showCreate && (
          <div className="bg-white rounded-xl p-6 mb-6" style={{ border: "1px solid #EFEFEF", boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }}>
            <h2 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "16px" }}>Новий маршрут</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label style={{ fontSize: "13px", color: "#6B7280", display: "block", marginBottom: "4px" }}>Дата</label>
                <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
              </div>
              <div>
                <label style={{ fontSize: "13px", color: "#6B7280", display: "block", marginBottom: "4px" }}>Водій</label>
                <select value={formDriverId} onChange={(e) => setFormDriverId(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}>
                  <option value="">Не призначений</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: "13px", color: "#6B7280", display: "block", marginBottom: "4px" }}>Транспорт</label>
                <input value={formVehicle} onChange={(e) => setFormVehicle(e.target.value)} placeholder="Напр: Renault Kangoo"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label style={{ fontSize: "13px", color: "#6B7280", display: "block", marginBottom: "4px" }}>Витрата (л/100км)</label>
                <input type="number" step="0.1" value={formFuelConsumption} onChange={(e) => setFormFuelConsumption(e.target.value)}
                  placeholder="8.5"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
              </div>
              <div>
                <label style={{ fontSize: "13px", color: "#6B7280", display: "block", marginBottom: "4px" }}>Ціна палива (грн/л)</label>
                <input type="number" step="0.01" value={formFuelPrice} onChange={(e) => setFormFuelPrice(e.target.value)}
                  placeholder="54.90"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
              </div>
              <div>
                <label style={{ fontSize: "13px", color: "#6B7280", display: "block", marginBottom: "4px" }}>Примітка</label>
                <input value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
              </div>
            </div>

            {/* Select orders */}
            <h3 style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px", color: "#6B7280" }}>
              Підтверджені замовлення ({confirmedOrders.length})
            </h3>
            {confirmedOrders.length === 0 ? (
              <p style={{ fontSize: "13px", color: "#9CA3AF", padding: "12px 0" }}>Немає замовлень для маршруту</p>
            ) : (
              <div className="space-y-2 mb-4 max-h-60 overflow-auto" style={{ border: "1px solid #E5E7EB", borderRadius: "8px", padding: "8px" }}>
                {confirmedOrders.map((o) => (
                  <label key={o.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={selectedOrderIds.includes(o.id)}
                      onChange={() => toggleOrder(o.id)}
                      style={{ width: "18px", height: "18px", accentColor: "#FFD600" }} />
                    <div className="flex-1">
                      <span style={{ fontSize: "14px", fontWeight: 600 }}>{o.number}</span>
                      <span style={{ fontSize: "13px", color: "#6B7280", marginLeft: "8px" }}>
                        {o.counterparty?.name || "—"}
                      </span>
                    </div>
                    <span style={{ fontSize: "14px", fontWeight: 600 }}>{formatPrice(o.totalAmount)}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={handleCreate} disabled={actionLoading || selectedOrderIds.length === 0}
                style={{
                  background: "#FFD600", color: "#0A0A0A", padding: "12px 24px", borderRadius: "8px",
                  fontWeight: 700, fontSize: "15px", border: "none", opacity: actionLoading ? 0.5 : 1,
                }}>
                {actionLoading ? "Створюю..." : `Створити маршрут (${selectedOrderIds.length} зам.)`}
              </button>
              <button onClick={() => setShowCreate(false)}
                style={{ padding: "12px 24px", borderRadius: "8px", fontSize: "15px", border: "1px solid #E5E7EB", background: "white" }}>
                Скасувати
              </button>
            </div>
          </div>
        )}

        {/* Routes list */}
        {routes.length > 0 && (
          <div className="space-y-4">
            {routes.map((r) => (
              <div key={r.id} className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF", boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }}>
                <div className="flex items-center justify-between" style={{ padding: "16px 20px", borderBottom: "1px solid #F3F4F6" }}>
                  <div className="flex items-center gap-3">
                    <span style={{ fontSize: "16px", fontWeight: 700 }}>{r.number}</span>
                    <span style={{
                      fontSize: "12px", fontWeight: 600, padding: "3px 10px", borderRadius: "6px",
                      background: ROUTE_STATUS_BG[r.status], color: ROUTE_STATUS_COLOR[r.status],
                    }}>
                      {ROUTE_STATUS_LABELS[r.status]}
                    </span>
                  </div>
                  <div className="text-right">
                    <p style={{ fontSize: "14px", fontWeight: 600 }}>{formatDate(r.date)}</p>
                    <p style={{ fontSize: "13px", color: "#6B7280" }}>
                      Водій: {r.driver?.name || "—"} | {r._count?.stops || 0} зупинок
                    </p>
                  </div>
                </div>
                {r.vehicleInfo && (
                  <div style={{ padding: "8px 20px", fontSize: "13px", color: "#6B7280", background: "#FAFAFA" }}>
                    Авто: {r.vehicleInfo}
                    {r.fuelConsumption && ` | ${r.fuelConsumption} л/100км`}
                    {r.totalDistanceKm && ` | ${r.totalDistanceKm} км`}
                    {r.totalFuelCost && ` | Паливо: ${formatPrice(r.totalFuelCost)}`}
                  </div>
                )}
                {/* AI optimize */}
                {r.status === "PLANNED" && r.stops?.length >= 2 && (
                  <div style={{ padding: "10px 20px", background: "#FAFAFA", borderTop: "1px solid #F3F4F6" }}>
                    <button onClick={async () => {
                      try {
                        const res = await fetch(`/api/erp/delivery-routes/${r.id}/optimize`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ startAddress: "Вінниця, склад" }),
                        });
                        const data = await res.json();
                        if (res.ok) {
                          alert(`Маршрут оптимізовано!\n${data.optimization?.reasoning || ""}\nВідстань: ~${data.optimization?.estimatedDistanceKm || "?"} км\nЧас: ~${data.optimization?.estimatedTimeMinutes || "?"} хв`);
                          fetchData();
                        } else { alert(data.error); }
                      } catch { alert("Помилка AI"); }
                    }}
                      style={{
                        padding: "8px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                        background: "linear-gradient(135deg, #8B5CF6, #6366F1)", color: "white", border: "none",
                      }}>
                      AI-оптимізація маршруту
                    </button>
                  </div>
                )}
                {/* Stops */}
                <div>
                  {r.stops?.map((stop: any, idx: number) => (
                    <div key={stop.id} className="flex items-center gap-3" style={{ padding: "10px 20px", borderBottom: "1px solid #F9FAFB" }}>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: stop.status === "DELIVERED" ? "#F0FDF4" : "#EFF6FF", fontSize: "12px", fontWeight: 700,
                          color: stop.status === "DELIVERED" ? "#16A34A" : "#2563EB" }}>
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p style={{ fontSize: "14px", fontWeight: 500 }}>{stop.counterparty?.name || "—"}</p>
                        {stop.address && <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{stop.address}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p style={{ fontSize: "13px", fontWeight: 600 }}>{stop.salesDocument?.number}</p>
                        <p style={{ fontSize: "13px", color: "#6B7280" }}>{formatPrice(stop.salesDocument?.totalAmount || 0)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
