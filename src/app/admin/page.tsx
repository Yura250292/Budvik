"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export default function AdminPage() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [stats, setStats] = useState({ clients: 0, sales: 0, wholesale: 0, orders: 0, products: 0, activeOrders: 0, pendingWholesale: 0 });

  const role = (session?.user as any)?.role;

  useEffect(() => {
    if (role !== "ADMIN" && role !== "SALES") return;

    Promise.all([
      role === "ADMIN" ? fetch("/api/admin/users").then((r) => r.json()) : Promise.resolve([]),
      fetch("/api/orders").then((r) => r.json()),
      fetch("/api/products").then((r) => r.json()),
      fetch("/api/admin/wholesale").then((r) => r.json()).catch(() => []),
    ]).then(([users, orders, products, wholesaleApps]) => {
      const usersList = Array.isArray(users) ? users : [];
      const ordersList = Array.isArray(orders) ? orders : [];
      const appsList = Array.isArray(wholesaleApps) ? wholesaleApps : [];
      setStats({
        clients: usersList.filter((u: any) => u.role === "CLIENT").length,
        sales: usersList.filter((u: any) => u.role === "SALES").length,
        wholesale: usersList.filter((u: any) => u.role === "WHOLESALE").length,
        orders: ordersList.length,
        activeOrders: ordersList.filter((o: any) => !["DELIVERED", "CANCELLED"].includes(o.status)).length,
        products: Array.isArray(products) ? products.length : 0,
        pendingWholesale: appsList.filter((a: any) => a.status === "PENDING").length,
      });
    });
  }, [role]);

  if (role !== "ADMIN" && role !== "SALES") {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-[#0A0A0A]">Доступ заборонено</h1>
        <p className="text-[#9E9E9E] mt-2">У вас немає доступу до панелі управління</p>
      </div>
    );
  }

  const navItems = [
    {
      href: "/admin/orders",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
      title: "Замовлення",
      desc: "Управління замовленнями та статусами",
      color: "from-amber-500 to-orange-600",
      bgLight: "bg-amber-50",
      badge: stats.activeOrders > 0 ? `${stats.activeOrders} активних` : null,
      roles: ["ADMIN", "SALES"],
    },
    {
      href: "/admin/products",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
      title: "Товари",
      desc: "Управління каталогом товарів",
      color: "from-emerald-500 to-green-600",
      bgLight: "bg-emerald-50",
      badge: null,
      roles: ["ADMIN"],
    },
    {
      href: "/admin/users",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      ),
      title: "Клієнти",
      desc: "Профілі, історія, призначення ролей",
      color: "from-violet-500 to-purple-600",
      bgLight: "bg-violet-50",
      badge: null,
      roles: ["ADMIN"],
    },
    {
      href: "/admin/wholesale",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      title: "Оптовики",
      desc: "Заявки та управління оптовиками",
      color: "from-yellow-500 to-amber-600",
      bgLight: "bg-yellow-50",
      badge: stats.pendingWholesale > 0 ? `${stats.pendingWholesale} нових` : null,
      roles: ["ADMIN"],
    },
    {
      href: "/admin/sales",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      title: "Торгові менеджери",
      desc: "Список торгових, зняття ролі",
      color: "from-blue-500 to-indigo-600",
      bgLight: "bg-blue-50",
      badge: null,
      roles: ["ADMIN"],
    },
    {
      href: "/admin/integration",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      ),
      title: "Інтеграція 1С",
      desc: "Імпорт/експорт товарів та замовлень",
      color: "from-slate-500 to-gray-700",
      bgLight: "bg-slate-50",
      badge: null,
      roles: ["ADMIN"],
    },
  ];

  const visibleNavItems = navItems.filter((item) => item.roles.includes(role));

  const accentColors: Record<string, string> = {
    "/admin/orders": "#FFD600",
    "/admin/products": "#3B82F6",
    "/admin/users": "#10B981",
    "/admin/wholesale": "#F59E0B",
    "/admin/sales": "#6366F1",
    "/admin/integration": "#64748B",
  };

  const statCards = [
    {
      label: "Замовлення",
      value: stats.orders,
      sub: stats.activeOrders > 0 ? `${stats.activeOrders} активних` : null,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
      color: "#FFD600",
      roles: ["ADMIN", "SALES"],
    },
    {
      label: "Товари",
      value: stats.products,
      sub: null,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
      color: "#3B82F6",
      roles: ["ADMIN", "SALES"],
    },
    {
      label: "Клієнти",
      value: stats.clients,
      sub: null,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
      color: "#10B981",
      roles: ["ADMIN"],
    },
    {
      label: "Оптовики",
      value: stats.wholesale,
      sub: stats.pendingWholesale > 0 ? `${stats.pendingWholesale} заявок` : null,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      color: "#F59E0B",
      roles: ["ADMIN"],
    },
    {
      label: "Торгові",
      value: stats.sales,
      sub: null,
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      color: "#6366F1",
      roles: ["ADMIN"],
    },
  ];

  const visibleStats = statCards.filter((s) => s.roles.includes(role));

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Sticky Header */}
      <header
        className="sticky top-0 z-50 bg-white"
        style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "#FFD600" }}
            >
              <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A", lineHeight: 1.2 }}>
                Панель управління
              </h1>
              <p style={{ fontSize: "14px", color: "#6B7280", marginTop: "2px" }}>
                {role === "ADMIN" ? "Адміністратор" : "Торговий менеджер"} — {session?.user?.name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="hidden sm:inline-flex items-center gap-2 transition-colors duration-200"
              style={{
                background: "#FFD600",
                color: "#0A0A0A",
                padding: "10px 16px",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "14px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#FFC400")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#FFD600")}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              На сайт
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "32px", paddingBottom: "40px" }}>
        {/* Section: Statistics Dashboard */}
        <section style={{ marginBottom: "40px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#0A0A0A", marginBottom: "20px" }}>
            Статистика
          </h2>
          <div
            className="grid gap-5"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
          >
            {visibleStats.map((card) => (
              <div
                key={card.label}
                className="group"
                style={{
                  background: "white",
                  borderRadius: "12px",
                  padding: "20px",
                  border: "1px solid #EFEFEF",
                  boxShadow: "0 6px 20px rgba(0,0,0,0.05)",
                  transition: "transform 0.2s ease, box-shadow 0.2s ease",
                  cursor: "default",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-3px)";
                  e.currentTarget.style.boxShadow = "0 10px 25px rgba(0,0,0,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.05)";
                }}
              >
                <div className="flex items-center gap-3" style={{ marginBottom: "12px" }}>
                  <div
                    className="flex items-center justify-center flex-shrink-0"
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "10px",
                      background: `${card.color}18`,
                      color: card.color,
                    }}
                  >
                    {card.icon}
                  </div>
                  <span style={{ fontSize: "14px", color: "#6B7280", fontWeight: 500 }}>
                    {card.label}
                  </span>
                </div>
                <p style={{ fontSize: "28px", fontWeight: 700, color: "#0A0A0A", lineHeight: 1 }}>
                  {card.value}
                </p>
                {card.sub && (
                  <p style={{ fontSize: "13px", color: card.color, fontWeight: 500, marginTop: "8px" }}>
                    {card.sub}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Section: ERP Modules */}
        <section style={{ marginBottom: "40px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#0A0A0A", marginBottom: "20px" }}>
            ERP — Облік
          </h2>
          <div
            className="grid gap-6"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}
          >
            {[
              {
                href: "/admin/erp/counterparties",
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                ),
                title: "Контрагенти",
                desc: "Постачальники та покупці",
                color: "from-teal-500 to-cyan-600",
                accentColor: "#14B8A6",
                roles: ["ADMIN", "SALES"],
              },
              {
                href: "/admin/erp/purchase-orders",
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                ),
                title: "Прихід",
                desc: "Прихідні накладні від постачальників",
                color: "from-sky-500 to-blue-600",
                accentColor: "#0EA5E9",
                roles: ["ADMIN", "SALES"],
              },
              {
                href: "/admin/erp/sales",
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ),
                title: "Продаж",
                desc: "Документи продажу B2B/оффлайн",
                color: "from-green-500 to-emerald-600",
                accentColor: "#22C55E",
                roles: ["ADMIN", "SALES"],
              },
              {
                href: "/admin/erp/invoices",
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
                  </svg>
                ),
                title: "Видаткові накладні",
                desc: "Генерація та трекінг оплат",
                color: "from-orange-500 to-red-500",
                accentColor: "#F97316",
                roles: ["ADMIN"],
              },
              {
                href: "/admin/erp/commissions",
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                ),
                title: "Мотивація",
                desc: "Комісії торгових менеджерів",
                color: "from-yellow-500 to-orange-500",
                accentColor: "#EAB308",
                roles: ["ADMIN"],
              },
              {
                href: "/admin/erp/stats",
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                ),
                title: "Статистика",
                desc: "Аналітика та бухгалтерські звіти",
                color: "from-indigo-500 to-violet-600",
                accentColor: "#6366F1",
                roles: ["ADMIN"],
              },
              {
                href: "/admin/erp/scan",
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                  </svg>
                ),
                title: "AI Сканер",
                desc: "Фото накладної → документ",
                color: "from-purple-500 to-fuchsia-600",
                accentColor: "#A855F7",
                roles: ["ADMIN", "SALES"],
              },
              {
                href: "/admin/erp/import",
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                ),
                title: "Імпорт з 1С",
                desc: "Контрагенти та документи",
                color: "from-rose-500 to-pink-600",
                accentColor: "#F43F5E",
                roles: ["ADMIN"],
              },
            ]
              .filter((item) => item.roles.includes(role))
              .map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group block"
                  style={{
                    background: "white",
                    borderRadius: "12px",
                    padding: "22px",
                    border: "1px solid #EFEFEF",
                    borderLeft: `4px solid ${item.accentColor}`,
                    cursor: "pointer",
                    transition: "transform 0.2s ease, box-shadow 0.2s ease",
                    boxShadow: "0 6px 20px rgba(0,0,0,0.05)",
                    textDecoration: "none",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-4px)";
                    e.currentTarget.style.boxShadow = "0 12px 30px rgba(0,0,0,0.08)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.05)";
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`w-12 h-12 bg-gradient-to-br ${item.color} rounded-xl flex items-center justify-center flex-shrink-0 text-white`}
                    >
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#0A0A0A", marginBottom: "4px" }}>
                        {item.title}
                      </h3>
                      <p style={{ fontSize: "14px", color: "#6B7280", lineHeight: 1.5 }}>
                        {item.desc}
                      </p>
                    </div>
                    <svg
                      className="w-5 h-5 flex-shrink-0"
                      style={{ color: "#D1D5DB", marginTop: "4px" }}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              ))}
          </div>
        </section>

        {/* Section: Management Modules */}
        <section>
          <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#0A0A0A", marginBottom: "20px" }}>
            Управління
          </h2>
          <div
            className="grid gap-6"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}
          >
            {visibleNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group block"
                style={{
                  background: "white",
                  borderRadius: "12px",
                  padding: "22px",
                  border: "1px solid #EFEFEF",
                  borderLeft: `4px solid ${accentColors[item.href] || "#FFD600"}`,
                  cursor: "pointer",
                  transition: "transform 0.2s ease, box-shadow 0.2s ease",
                  boxShadow: "0 6px 20px rgba(0,0,0,0.05)",
                  textDecoration: "none",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-4px)";
                  e.currentTarget.style.boxShadow = "0 12px 30px rgba(0,0,0,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 6px 20px rgba(0,0,0,0.05)";
                }}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`w-12 h-12 bg-gradient-to-br ${item.color} rounded-xl flex items-center justify-center flex-shrink-0 text-white`}
                  >
                    {item.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2" style={{ marginBottom: "4px" }}>
                      <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#0A0A0A" }}>
                        {item.title}
                      </h3>
                      {item.badge && (
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            background: "#FFD600",
                            color: "#0A0A0A",
                            padding: "2px 8px",
                            borderRadius: "9999px",
                          }}
                        >
                          {item.badge}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: "14px", color: "#6B7280", lineHeight: 1.5 }}>
                      {item.desc}
                    </p>
                  </div>
                  <svg
                    className="w-5 h-5 flex-shrink-0 transition-colors duration-200"
                    style={{ color: "#D1D5DB", marginTop: "4px" }}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    onMouseEnter={() => {}}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer
        style={{
          marginTop: "60px",
          padding: "40px 24px",
          background: "#FAFAFA",
          borderTop: "1px solid #EFEFEF",
        }}
      >
        <div className="max-w-7xl mx-auto">
          <p style={{ fontSize: "13px", color: "#6B7280" }}>
            Budvik — Панель управління
          </p>
        </div>
      </footer>
    </div>
  );
}
