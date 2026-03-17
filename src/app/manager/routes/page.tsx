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

export default function ManagerRoutesPage() {
  const { data: session } = useSession();
  const [routes, setRoutes] = useState<any[]>([]);
  const [confirmedOrders, setConfirmedOrders] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Form
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
    if (role === "ADMIN" || role === "MANAGER") fetchData();
  }, [role, fetchData]);

  const toggleOrder = (id: string) => {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    if (selectedOrderIds.length === confirmedOrders.length) setSelectedOrderIds([]);
    else setSelectedOrderIds(confirmedOrders.map((o) => o.id));
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
      if (!res.ok) alert(data.error || "Помилка");
      else {
        setShowCreate(false);
        setSelectedOrderIds([]);
        setFormDriverId(""); setFormVehicle(""); setFormFuelConsumption(""); setFormFuelPrice(""); setFormNotes("");
        fetchData();
      }
    } catch { alert("Мережева помилка"); }
    setActionLoading(false);
  };

  if (role !== "ADMIN" && role !== "MANAGER") {
    return <div className="p-8 text-center font-bold">Доступ заборонено</div>;
  }

  const activeRoutes = routes.filter((r) => r.status === "PLANNED" || r.status === "IN_PROGRESS");
  const doneRoutes = routes.filter((r) => r.status === "COMPLETED" || r.status === "CANCELLED");

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF" }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between" style={{ padding: "14px 16px" }}>
          <div className="flex items-center gap-3">
            <Link href="/manager" className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "#FFD600" }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#0A0A0A", lineHeight: 1.2 }}>Дорожні листи</h1>
              <p style={{ fontSize: "13px", color: "#6B7280" }}>
                {confirmedOrders.length > 0
                  ? `${confirmedOrders.length} замовлень чекають маршруту`
                  : "Маршрути доставки"}
              </p>
            </div>
          </div>
          <button onClick={() => setShowCreate(!showCreate)}
            style={{
              background: showCreate ? "#F3F4F6" : "#FFD600",
              color: showCreate ? "#6B7280" : "#0A0A0A",
              padding: "10px 18px", borderRadius: "10px",
              fontWeight: 700, fontSize: "14px", border: "none",
            }}>
            {showCreate ? "Скасувати" : "+ Новий"}
          </button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4" style={{ paddingTop: "16px", paddingBottom: "60px" }}>

        {/* Create form */}
        {showCreate && (
          <div className="bg-white rounded-2xl p-5 mb-6" style={{ border: "1px solid #EFEFEF", boxShadow: "0 4px 16px rgba(0,0,0,0.06)" }}>
            <h2 style={{ fontSize: "17px", fontWeight: 700, color: "#0A0A0A", marginBottom: "16px" }}>
              Новий дорожній лист
            </h2>

            {/* Date + Driver */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label style={{ fontSize: "12px", color: "#6B7280", display: "block", marginBottom: "4px", fontWeight: 500 }}>
                  Дата доставки
                </label>
                <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
              </div>
              <div>
                <label style={{ fontSize: "12px", color: "#6B7280", display: "block", marginBottom: "4px", fontWeight: 500 }}>
                  Водій
                </label>
                <select value={formDriverId} onChange={(e) => setFormDriverId(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "14px", background: "white" }}>
                  <option value="">Не призначений</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>

            {/* Vehicle + Fuel */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="col-span-3 sm:col-span-1">
                <label style={{ fontSize: "12px", color: "#6B7280", display: "block", marginBottom: "4px", fontWeight: 500 }}>
                  Авто
                </label>
                <input value={formVehicle} onChange={(e) => setFormVehicle(e.target.value)}
                  placeholder="Renault Kangoo"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
              </div>
              <div>
                <label style={{ fontSize: "12px", color: "#6B7280", display: "block", marginBottom: "4px", fontWeight: 500 }}>
                  л/100км
                </label>
                <input type="number" step="0.1" value={formFuelConsumption} onChange={(e) => setFormFuelConsumption(e.target.value)}
                  placeholder="8.5"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
              </div>
              <div>
                <label style={{ fontSize: "12px", color: "#6B7280", display: "block", marginBottom: "4px", fontWeight: 500 }}>
                  грн/л
                </label>
                <input type="number" step="0.01" value={formFuelPrice} onChange={(e) => setFormFuelPrice(e.target.value)}
                  placeholder="54.90"
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
              </div>
            </div>

            {/* Notes */}
            <div className="mb-4">
              <label style={{ fontSize: "12px", color: "#6B7280", display: "block", marginBottom: "4px", fontWeight: 500 }}>
                Примітка
              </label>
              <input value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Додаткова інформація для водія"
                style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
            </div>

            {/* Order selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}>
                  Замовлення для маршруту ({confirmedOrders.length})
                </p>
                {confirmedOrders.length > 0 && (
                  <button onClick={selectAll}
                    style={{ fontSize: "12px", color: "#2563EB", fontWeight: 500, background: "none", border: "none", padding: 0 }}>
                    {selectedOrderIds.length === confirmedOrders.length ? "Зняти всі" : "Вибрати всі"}
                  </button>
                )}
              </div>
              {confirmedOrders.length === 0 ? (
                <p style={{ fontSize: "13px", color: "#9CA3AF", padding: "12px", background: "#F9FAFB", borderRadius: "10px", textAlign: "center" }}>
                  Немає підтверджених замовлень
                </p>
              ) : (
                <div className="space-y-1 mb-4" style={{ maxHeight: "240px", overflow: "auto", border: "1px solid #E5E7EB", borderRadius: "10px", padding: "6px" }}>
                  {confirmedOrders.map((o) => (
                    <label key={o.id}
                      className="flex items-center gap-3 rounded-lg cursor-pointer"
                      style={{
                        padding: "10px 12px",
                        background: selectedOrderIds.includes(o.id) ? "#EFF6FF" : "transparent",
                      }}>
                      <input type="checkbox" checked={selectedOrderIds.includes(o.id)}
                        onChange={() => toggleOrder(o.id)}
                        style={{ width: "18px", height: "18px", accentColor: "#FFD600", flexShrink: 0 }} />
                      <div className="flex-1 min-w-0">
                        <p style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>
                          {o.counterparty?.name || "—"}
                        </p>
                        <p style={{ fontSize: "12px", color: "#9CA3AF" }}>
                          {o.number} · {o.salesRep?.name || "—"} · {o._count?.items} поз.
                        </p>
                      </div>
                      <span style={{ fontSize: "14px", fontWeight: 700, color: "#0A0A0A", flexShrink: 0 }}>
                        {formatPrice(o.totalAmount)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Create button */}
            {selectedOrderIds.length > 0 && (
              <div style={{ padding: "12px", background: "#F0FDF4", borderRadius: "10px", marginBottom: "12px" }}>
                <p style={{ fontSize: "13px", color: "#16A34A", fontWeight: 600 }}>
                  Обрано: {selectedOrderIds.length} замовлень · {formatPrice(
                    confirmedOrders
                      .filter((o) => selectedOrderIds.includes(o.id))
                      .reduce((s, o) => s + o.totalAmount, 0)
                  )}
                </p>
              </div>
            )}
            <button onClick={handleCreate} disabled={actionLoading || selectedOrderIds.length === 0}
              style={{
                width: "100%", background: selectedOrderIds.length === 0 ? "#E5E7EB" : "#FFD600",
                color: selectedOrderIds.length === 0 ? "#9CA3AF" : "#0A0A0A",
                padding: "14px", borderRadius: "12px", fontWeight: 700,
                fontSize: "15px", border: "none", opacity: actionLoading ? 0.6 : 1,
              }}>
              {actionLoading ? "Створюю маршрут..." : `Створити дорожній лист (${selectedOrderIds.length} зам.)`}
            </button>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="text-center py-16" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : routes.length === 0 && !showCreate ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: "#F3F4F6" }}>
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="#9CA3AF" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </div>
            <p style={{ fontSize: "16px", fontWeight: 500, color: "#6B7280" }}>Маршрутів ще немає</p>
            <button onClick={() => setShowCreate(true)}
              style={{
                marginTop: "12px", background: "#FFD600", color: "#0A0A0A",
                padding: "12px 24px", borderRadius: "12px", fontWeight: 700, fontSize: "14px", border: "none",
              }}>
              Створити перший маршрут
            </button>
          </div>
        ) : null}

        {/* Active routes */}
        {activeRoutes.length > 0 && (
          <div className="mb-6">
            <p style={{ fontSize: "13px", fontWeight: 600, color: "#9CA3AF", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Активні
            </p>
            <div className="space-y-3">
              {activeRoutes.map((r) => <RouteCard key={r.id} route={r} />)}
            </div>
          </div>
        )}

        {/* Done routes */}
        {doneRoutes.length > 0 && (
          <div>
            <p style={{ fontSize: "13px", fontWeight: 600, color: "#9CA3AF", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Завершені
            </p>
            <div className="space-y-3">
              {doneRoutes.map((r) => <RouteCard key={r.id} route={r} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RouteCard({ route: r }: { route: any }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-2xl overflow-hidden"
      style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left" style={{ padding: "16px" }}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span style={{ fontSize: "15px", fontWeight: 700, color: "#0A0A0A" }}>{r.number}</span>
              <span style={{
                fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "6px",
                background: ROUTE_STATUS_BG[r.status], color: ROUTE_STATUS_COLOR[r.status], flexShrink: 0,
              }}>
                {ROUTE_STATUS_LABELS[r.status]}
              </span>
            </div>
            <p style={{ fontSize: "13px", color: "#9CA3AF" }}>
              {formatDate(r.date)} · Водій: {r.driver?.name || "—"} · {r._count?.stops || 0} зупинок
            </p>
            {r.vehicleInfo && (
              <p style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "2px" }}>
                {r.vehicleInfo}
                {r.fuelConsumption ? ` · ${r.fuelConsumption} л/100км` : ""}
                {r.totalDistanceKm ? ` · ${r.totalDistanceKm} км` : ""}
              </p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            {r.totalFuelCost && (
              <p style={{ fontSize: "13px", fontWeight: 600, color: "#D97706" }}>
                Паливо: {formatPrice(r.totalFuelCost)}
              </p>
            )}
            <svg
              className="w-4 h-4 ml-auto mt-1"
              fill="none" viewBox="0 0 24 24" stroke="#9CA3AF" strokeWidth={2}
              style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </button>

      {expanded && r.stops?.length > 0 && (
        <div style={{ borderTop: "1px solid #F3F4F6" }}>
          {r.stops.map((stop: any, idx: number) => (
            <div key={stop.id} className="flex items-center gap-3"
              style={{ padding: "12px 16px", borderBottom: "1px solid #F9FAFB" }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  background: stop.status === "DELIVERED" ? "#F0FDF4" : "#F9FAFB",
                  fontSize: "12px", fontWeight: 700,
                  color: stop.status === "DELIVERED" ? "#16A34A" : "#6B7280",
                  border: stop.status === "DELIVERED" ? "1px solid #BBF7D0" : "1px solid #E5E7EB",
                }}>
                {stop.status === "DELIVERED" ? "✓" : idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p style={{ fontSize: "14px", fontWeight: 500, color: "#0A0A0A" }}>
                  {stop.counterparty?.name || stop.salesDocument?.counterparty?.name || "—"}
                </p>
                {stop.address && (
                  <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{stop.address}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p style={{ fontSize: "13px", fontWeight: 600, color: "#0A0A0A" }}>
                  {stop.salesDocument?.number}
                </p>
                <p style={{ fontSize: "12px", color: "#6B7280" }}>
                  {formatPrice(stop.salesDocument?.totalAmount || 0)}
                </p>
              </div>
            </div>
          ))}
          {r.notes && (
            <div style={{ padding: "10px 16px", background: "#FFFBEB", borderTop: "1px solid #FEF3C7" }}>
              <p style={{ fontSize: "13px", color: "#92400E" }}>Примітка: {r.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
