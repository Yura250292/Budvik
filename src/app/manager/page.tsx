"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatPrice } from "@/lib/utils";

export default function ManagerDashboard() {
  const { data: session } = useSession();
  const [stats, setStats] = useState<any>(null);
  const [pending, setPending] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const role = (session?.user as any)?.role;
  const userName = (session?.user as any)?.name || "Менеджер";
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const markAllRead = async () => {
    await fetch("/api/notifications/read-all", { method: "PATCH" });
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  useEffect(() => {
    if (!session) return;
    fetch("/api/notifications").then((r) => r.json()).then((d) => setNotifications(Array.isArray(d) ? d : []));
  }, [session]);

  useEffect(() => {
    if (!session) return;
    Promise.all([
      fetch("/api/erp/sales").then((r) => r.json()),
      fetch("/api/erp/delivery-routes").then((r) => r.json()),
    ]).then(([salesRaw, routesRaw]) => {
      const docs = Array.isArray(salesRaw) ? salesRaw : [];
      const routes = Array.isArray(routesRaw) ? routesRaw : [];
      const today = new Date().toDateString();

      const draft = docs.filter((d: any) => d.status === "DRAFT");
      const confirmed = docs.filter((d: any) => d.status === "CONFIRMED");
      const packing = docs.filter((d: any) => d.status === "PACKING");
      const inTransit = docs.filter((d: any) => d.status === "IN_TRANSIT");
      const todayDelivered = docs.filter(
        (d: any) => d.status === "DELIVERED" && new Date(d.updatedAt).toDateString() === today
      );

      setStats({
        draft: draft.length,
        draftAmount: draft.reduce((s: number, d: any) => s + d.totalAmount, 0),
        confirmed: confirmed.length,
        confirmedAmount: confirmed.reduce((s: number, d: any) => s + d.totalAmount, 0),
        packing: packing.length,
        inTransit: inTransit.length,
        todayDelivered: todayDelivered.length,
        todayRevenue: todayDelivered.reduce((s: number, d: any) => s + d.totalAmount, 0),
        activeRoutes: routes.filter((r: any) => r.status === "IN_PROGRESS").length,
        plannedRoutes: routes.filter((r: any) => r.status === "PLANNED").length,
      });
      setPending(draft.slice(0, 5));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [session]);

  if (role !== "ADMIN" && role !== "MANAGER") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-lg font-bold">Доступ заборонено</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Dark branded header */}
      <div style={{
        background: "linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 100%)",
        padding: "20px 20px 40px",
        position: "relative",
        overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, height: "2px",
          background: "linear-gradient(to right, transparent, #FFD600, transparent)",
        }} />
        <div style={{
          position: "absolute", top: "-50px", right: "-30px",
          width: "220px", height: "220px", borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255,214,0,0.07) 0%, transparent 70%)",
        }} />

        <div className="max-w-lg mx-auto relative">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Image src="/logo-gold.png" alt="Budvik" width={36} height={36} className="h-9 w-auto" />
              <div>
                <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", letterSpacing: "1.5px", textTransform: "uppercase" }}>
                  Менеджер
                </p>
                <h1 style={{ fontSize: "22px", fontWeight: 700, color: "white" }}>{userName}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Notification bell */}
              <button
                onClick={() => { setShowNotifications((v) => !v); if (unreadCount > 0) markAllRead(); }}
                style={{ position: "relative", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", padding: "8px", color: "white" }}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
                {unreadCount > 0 && (
                  <span style={{
                    position: "absolute", top: "-4px", right: "-4px",
                    background: "#EF4444", color: "white", borderRadius: "9999px",
                    fontSize: "11px", fontWeight: 700, minWidth: "18px", height: "18px",
                    display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
                  }}>
                    {unreadCount}
                  </span>
                )}
              </button>
              <Link href="/admin" style={{
                fontSize: "12px", color: "rgba(255,255,255,0.4)", textDecoration: "none",
                padding: "6px 12px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px",
              }}>
                Адмін
              </Link>
            </div>

            {/* Notifications dropdown */}
            {showNotifications && (
              <div style={{
                position: "absolute", top: "56px", right: 0, zIndex: 50,
                background: "white", borderRadius: "16px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
                width: "320px", maxHeight: "400px", overflowY: "auto",
              }}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid #F0F0F0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: "14px", color: "#0A0A0A" }}>Сповіщення</span>
                  {unreadCount > 0 && (
                    <button onClick={markAllRead} style={{ fontSize: "12px", color: "#6B7280" }}>Прочитати всі</button>
                  )}
                </div>
                {notifications.length === 0 ? (
                  <div style={{ padding: "24px 16px", textAlign: "center", color: "#9CA3AF", fontSize: "13px" }}>
                    Немає сповіщень
                  </div>
                ) : (
                  notifications.map((n) => (
                    <Link
                      key={n.id}
                      href={n.relatedId ? `/admin/erp/sales/${n.relatedId}` : "/manager"}
                      onClick={() => setShowNotifications(false)}
                      style={{ display: "block", padding: "12px 16px", borderBottom: "1px solid #F7F7F7", background: n.isRead ? "white" : "#FFF9E6", textDecoration: "none" }}
                    >
                      <p style={{ fontWeight: 600, fontSize: "13px", color: "#0A0A0A" }}>{n.title}</p>
                      <p style={{ fontSize: "12px", color: "#6B7280", marginTop: "2px" }}>{n.body}</p>
                      <p style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "4px" }}>
                        {new Date(n.createdAt).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </Link>
                  ))
                )}
              </div>
            )}
          </div>

          {!loading && stats && (
            <div className="grid grid-cols-3 gap-2">
              <div style={{
                background: stats.draft > 0 ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.06)",
                borderRadius: "14px", padding: "12px",
                border: stats.draft > 0 ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(255,255,255,0.08)",
              }}>
                <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginBottom: "3px" }}>Нові</p>
                <p style={{ fontSize: "26px", fontWeight: 700, color: stats.draft > 0 ? "#F87171" : "white", lineHeight: 1 }}>
                  {stats.draft}
                </p>
                <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginTop: "2px" }}>замовлень</p>
              </div>
              <div style={{
                background: "rgba(255,255,255,0.06)", borderRadius: "14px",
                padding: "12px", border: "1px solid rgba(255,255,255,0.08)",
              }}>
                <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginBottom: "3px" }}>В дорозі</p>
                <p style={{ fontSize: "26px", fontWeight: 700, color: "#FFD600", lineHeight: 1 }}>
                  {stats.inTransit}
                </p>
                <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginTop: "2px" }}>маршрутів</p>
              </div>
              <div style={{
                background: "rgba(255,255,255,0.06)", borderRadius: "14px",
                padding: "12px", border: "1px solid rgba(255,255,255,0.08)",
              }}>
                <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", marginBottom: "3px" }}>Сьогодні</p>
                <p style={{ fontSize: "26px", fontWeight: 700, color: "#22C55E", lineHeight: 1 }}>
                  {stats.todayDelivered}
                </p>
                <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginTop: "2px" }}>доставлено</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4" style={{ marginTop: "-20px", paddingBottom: "100px" }}>

        {/* Urgent alert: new orders */}
        {!loading && stats && stats.draft > 0 && (
          <Link href="/manager/orders?status=DRAFT" style={{ textDecoration: "none", display: "block", marginBottom: "16px" }}>
            <div style={{
              background: "linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)",
              borderRadius: "16px", padding: "16px 20px",
              boxShadow: "0 8px 32px rgba(220,38,38,0.25)",
            }}>
              <div className="flex items-center gap-3">
                <div style={{
                  width: "44px", height: "44px", background: "rgba(255,255,255,0.2)",
                  borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p style={{ fontSize: "16px", fontWeight: 700, color: "white" }}>
                    {stats.draft} {stats.draft === 1 ? "нове замовлення" : "нових замовлень"}
                  </p>
                  <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.75)" }}>
                    {formatPrice(stats.draftAmount)} — потребують підтвердження
                  </p>
                </div>
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.6)" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>
        )}

        {/* Confirmed orders ready for route */}
        {!loading && stats && stats.confirmed > 0 && (
          <Link href="/manager/routes" style={{ textDecoration: "none", display: "block", marginBottom: "16px" }}>
            <div style={{
              background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
              borderRadius: "16px", padding: "16px 20px",
              boxShadow: "0 8px 32px rgba(245,158,11,0.25)",
            }}>
              <div className="flex items-center gap-3">
                <div style={{
                  width: "44px", height: "44px", background: "rgba(255,255,255,0.2)",
                  borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p style={{ fontSize: "16px", fontWeight: 700, color: "white" }}>
                    {stats.confirmed} {stats.confirmed === 1 ? "замовлення" : "замовлень"} готові до маршруту
                  </p>
                  <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.75)" }}>
                    {formatPrice(stats.confirmedAmount)} — сформувати дорожній лист
                  </p>
                </div>
                <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="rgba(255,255,255,0.6)" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>
        )}

        {/* Stats grid */}
        {!loading && stats && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-white rounded-2xl p-4" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: "#FDF4FF" }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#9333EA" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "2px" }}>Пакується</p>
              <p style={{ fontSize: "22px", fontWeight: 700, color: "#0A0A0A" }}>{stats.packing}</p>
              <p style={{ fontSize: "11px", color: "#9CA3AF" }}>на складі</p>
            </div>
            <div className="bg-white rounded-2xl p-4" style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ background: "#F0FDF4" }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#16A34A" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p style={{ fontSize: "12px", color: "#6B7280", marginBottom: "2px" }}>Доставлено сьогодні</p>
              <p style={{ fontSize: "22px", fontWeight: 700, color: "#0A0A0A" }}>{stats.todayDelivered}</p>
              <p style={{ fontSize: "11px", color: "#9CA3AF" }}>{formatPrice(stats.todayRevenue)}</p>
            </div>
          </div>
        )}

        {/* Pending orders preview */}
        {!loading && pending.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <p style={{ fontSize: "13px", fontWeight: 600, color: "#9CA3AF", letterSpacing: "0.5px", textTransform: "uppercase" }}>
                Очікують підтвердження
              </p>
              <Link href="/manager/orders?status=DRAFT" style={{ fontSize: "13px", color: "#2563EB", textDecoration: "none", fontWeight: 500 }}>
                Всі →
              </Link>
            </div>
            <div className="space-y-2">
              {pending.map((doc) => (
                <Link key={doc.id} href={`/admin/erp/sales/${doc.id}`}
                  className="flex items-center gap-3 bg-white rounded-2xl p-4"
                  style={{ border: "1px solid #EFEFEF", textDecoration: "none", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "#FFF7ED" }}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#F59E0B" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>{doc.counterparty?.name || "—"}</p>
                    <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{doc.number} · {doc.salesRep?.name || "—"}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p style={{ fontSize: "14px", fontWeight: 700, color: "#0A0A0A" }}>{formatPrice(doc.totalAmount)}</p>
                    <p style={{ fontSize: "11px", color: "#9CA3AF" }}>{doc._count?.items} поз.</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Main menu */}
        <p style={{ fontSize: "13px", fontWeight: 600, color: "#9CA3AF", marginBottom: "12px", letterSpacing: "0.5px", textTransform: "uppercase" }}>
          Розділи
        </p>
        <div className="space-y-2">
          <MenuItem
            href="/manager/orders"
            gradient="linear-gradient(135deg, #EF4444, #DC2626)"
            title="Замовлення"
            desc="Перевірка та підтвердження накладних"
            badge={!loading && stats?.draft > 0 ? stats.draft : null}
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
          />
          <MenuItem
            href="/manager/routes"
            gradient="linear-gradient(135deg, #F59E0B, #D97706)"
            title="Дорожні листи"
            desc="Формувати маршрути, AI-оптимізація на карті"
            badge={!loading && stats?.confirmed > 0 ? stats.confirmed : null}
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            }
          />
          <MenuItem
            href="/admin/erp/commissions"
            gradient="linear-gradient(135deg, #22C55E, #16A34A)"
            title="Комісії торгових"
            desc="Затвердити та виплатити"
            badge={null}
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          />
          <MenuItem
            href="/warehouse"
            gradient="linear-gradient(135deg, #0EA5E9, #0284C7)"
            title="Склад"
            desc="Пакування та відвантаження"
            badge={!loading && stats?.packing > 0 ? stats.packing : null}
            icon={
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="white" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            }
          />
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  href, gradient, title, desc, badge, icon,
}: {
  href: string;
  gradient: string;
  title: string;
  desc: string;
  badge: number | null;
  icon: React.ReactNode;
}) {
  return (
    <Link href={href}
      className="flex items-center gap-4 bg-white rounded-2xl p-4"
      style={{ border: "1px solid #EFEFEF", textDecoration: "none", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: gradient }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p style={{ fontSize: "16px", fontWeight: 600, color: "#0A0A0A" }}>{title}</p>
        <p style={{ fontSize: "13px", color: "#6B7280" }}>{desc}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {badge != null && (
          <span style={{
            background: "#EF4444", color: "white",
            fontSize: "12px", fontWeight: 700,
            borderRadius: "999px", padding: "2px 8px", minWidth: "24px", textAlign: "center",
          }}>
            {badge}
          </span>
        )}
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#D1D5DB" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}
