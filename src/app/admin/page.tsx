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

  return (
    <div className="min-h-screen">
      {/* Hero header */}
      <div className="bg-gradient-to-br from-[#0A0A0A] via-[#141414] to-[#1E1E1E] text-white">
        <div className="max-w-7xl mx-auto px-4 pt-6 sm:pt-8 pb-20 sm:pb-24">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 bg-gradient-to-br from-[#FFD600] to-[#FFB800] rounded-xl flex items-center justify-center shadow-lg shadow-yellow-500/20">
                  <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold">Панель управління</h1>
                  <p className="text-white/50 text-sm mt-0.5">
                    {role === "ADMIN" ? "Адміністратор" : "Торговий менеджер"} — {session?.user?.name}
                  </p>
                </div>
              </div>
            </div>
            <Link
              href="/"
              className="hidden sm:flex items-center gap-2 text-white/50 hover:text-white transition text-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              На сайт
            </Link>
          </div>
        </div>
      </div>

      {/* Stats cards - pull up over hero */}
      <div className="max-w-7xl mx-auto px-4 -mt-14 sm:-mt-16 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4 mb-8">
          {/* Orders */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#EFEFEF]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08)' }}>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <span className="text-[11px] text-[#9E9E9E] uppercase tracking-wider font-semibold">Замовлень</span>
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-[#0A0A0A]">{stats.orders}</p>
            {stats.activeOrders > 0 && (
              <p className="text-xs text-amber-600 font-medium mt-1">{stats.activeOrders} активних</p>
            )}
          </div>

          {/* Products */}
          <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#EFEFEF]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08)' }}>
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <span className="text-[11px] text-[#9E9E9E] uppercase tracking-wider font-semibold">Товарів</span>
            </div>
            <p className="text-2xl sm:text-3xl font-bold text-[#0A0A0A]">{stats.products}</p>
          </div>

          {role === "ADMIN" && (
            <>
              {/* Clients */}
              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#EFEFEF]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08)' }}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
                    <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <span className="text-[11px] text-[#9E9E9E] uppercase tracking-wider font-semibold">Клієнтів</span>
                </div>
                <p className="text-2xl sm:text-3xl font-bold text-[#0A0A0A]">{stats.clients}</p>
              </div>

              {/* Wholesale */}
              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#EFEFEF]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08)' }}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-9 h-9 bg-gradient-to-br from-yellow-500 to-amber-600 rounded-xl flex items-center justify-center flex-shrink-0">
                    <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  <span className="text-[11px] text-[#9E9E9E] uppercase tracking-wider font-semibold">Оптовиків</span>
                </div>
                <p className="text-2xl sm:text-3xl font-bold text-[#FFB800]">{stats.wholesale}</p>
                {stats.pendingWholesale > 0 && (
                  <p className="text-xs text-amber-600 font-medium mt-1">{stats.pendingWholesale} заявок</p>
                )}
              </div>

              {/* Sales managers */}
              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-[#EFEFEF]" style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08)' }}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
                    <svg className="w-4.5 h-4.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <span className="text-[11px] text-[#9E9E9E] uppercase tracking-wider font-semibold">Торгових</span>
                </div>
                <p className="text-2xl sm:text-3xl font-bold text-[#0A0A0A]">{stats.sales}</p>
              </div>
            </>
          )}
        </div>

        {/* Navigation cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 pb-8">
          {visibleNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="group bg-white rounded-2xl p-5 sm:p-6 border border-[#EFEFEF] hover:border-[#FFD600]/40 transition-all duration-200 hover:-translate-y-0.5 relative overflow-hidden"
              style={{ boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.04)' }}
            >
              {/* Accent line */}
              <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${item.color} opacity-0 group-hover:opacity-100 transition-opacity duration-200`} />

              <div className="flex items-start gap-4">
                <div className={`w-12 h-12 bg-gradient-to-br ${item.color} rounded-xl flex items-center justify-center flex-shrink-0 text-white shadow-sm`}>
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-bold text-[#0A0A0A] group-hover:text-[#0A0A0A] text-[15px]">{item.title}</h3>
                    {item.badge && (
                      <span className="text-[10px] font-bold bg-[#FFD600] text-[#0A0A0A] px-2 py-0.5 rounded-full">{item.badge}</span>
                    )}
                  </div>
                  <p className="text-sm text-[#9E9E9E] leading-relaxed">{item.desc}</p>
                </div>
                <svg className="w-5 h-5 text-[#DADADA] group-hover:text-[#FFB800] transition flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
