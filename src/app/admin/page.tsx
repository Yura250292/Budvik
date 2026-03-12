"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState } from "react";
export default function AdminPage() {
  const { data: session } = useSession();
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
        <div className="w-14 h-14 bg-[#FFEAEA] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-[#C62828]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-bk">Доступ заборонено</h1>
        <p className="text-g400 mt-2 text-sm">У вас немає доступу до панелі управління</p>
      </div>
    );
  }

  const statCards = [
    {
      label: "Замовлення",
      value: stats.orders,
      sub: stats.activeOrders > 0 ? `${stats.activeOrders} активних` : null,
      href: "/admin/orders",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
      roles: ["ADMIN", "SALES"],
    },
    {
      label: "Товари",
      value: stats.products,
      sub: null,
      href: "/admin/products",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
      roles: ["ADMIN", "SALES"],
    },
    {
      label: "Клієнти",
      value: stats.clients,
      sub: null,
      href: "/admin/users",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
      roles: ["ADMIN"],
    },
    {
      label: "Оптовики",
      value: stats.wholesale,
      sub: stats.pendingWholesale > 0 ? `${stats.pendingWholesale} заявок` : null,
      href: "/admin/wholesale",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      roles: ["ADMIN"],
    },
    {
      label: "Торгові",
      value: stats.sales,
      sub: null,
      href: "/admin/sales",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      roles: ["ADMIN"],
    },
  ];

  const visibleStats = statCards.filter((s) => s.roles.includes(role));

  const erpModules = [
    {
      href: "/admin/erp/counterparties",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      title: "Контрагенти",
      desc: "Постачальники та покупці",
      roles: ["ADMIN", "SALES"],
    },
    {
      href: "/admin/erp/purchase-orders",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      title: "Прихід",
      desc: "Прихідні накладні",
      roles: ["ADMIN", "SALES"],
    },
    {
      href: "/admin/erp/sales",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      title: "Продаж",
      desc: "Документи B2B/оффлайн",
      roles: ["ADMIN", "SALES"],
    },
    {
      href: "/admin/erp/invoices",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
        </svg>
      ),
      title: "Видаткові накладні",
      desc: "Генерація та оплати",
      roles: ["ADMIN"],
    },
    {
      href: "/admin/erp/commissions",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      ),
      title: "Мотивація",
      desc: "Комісії менеджерів",
      roles: ["ADMIN"],
    },
    {
      href: "/admin/erp/stats",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      title: "Статистика",
      desc: "Аналітика та звіти",
      roles: ["ADMIN"],
    },
    {
      href: "/admin/erp/scan",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
        </svg>
      ),
      title: "AI Сканер",
      desc: "Фото \u2192 документ",
      roles: ["ADMIN", "SALES"],
    },
    {
      href: "/admin/erp/price-check",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      title: "Моніторинг цін",
      desc: "AI аналіз цін конкурентів",
      roles: ["ADMIN"],
    },
    {
      href: "/admin/erp/seasonal",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
        </svg>
      ),
      title: "Сезонні товари",
      desc: "Рекомендації по порі року",
      roles: ["ADMIN"],
    },
    {
      href: "/admin/erp/images",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
        </svg>
      ),
      title: "Зображення",
      desc: "Парсинг та AI-пошук фото",
      roles: ["ADMIN"],
    },
    {
      href: "/admin/erp/import",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
      ),
      title: "Імпорт з 1С",
      desc: "Контрагенти та документи",
      roles: ["ADMIN"],
    },
  ];

  const visibleModules = erpModules.filter((item) => item.roles.includes(role));

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-g200 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-[var(--radius-btn)] bg-bk flex items-center justify-center flex-shrink-0">
              <svg className="w-4.5 h-4.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-bk leading-tight truncate">
                Панель управління
              </h1>
              <p className="text-xs text-g400">
                {role === "ADMIN" ? "Адміністратор" : "Торговий менеджер"} — {session?.user?.name}
              </p>
            </div>
          </div>
          <Link
            href="/"
            className="flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-semibold text-bk bg-primary hover:bg-primary-hover rounded-[var(--radius-btn)] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span className="hidden sm:inline">На сайт</span>
          </Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-8">
        {/* Stats */}
        <section className="mb-6">
          <h2 className="text-[13px] font-semibold text-g400 uppercase tracking-wider mb-3">
            Статистика
          </h2>
          <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {visibleStats.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className="bg-white rounded-[var(--radius-card)] border border-g200 p-3.5 sm:p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:border-g300 transition-all group"
              >
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-7 h-7 rounded-lg bg-bk flex items-center justify-center flex-shrink-0 text-primary">
                    {card.icon}
                  </div>
                  <span className="text-[12px] text-g400 font-medium truncate uppercase tracking-wide">
                    {card.label}
                  </span>
                </div>
                <p className="text-2xl sm:text-[28px] font-bold text-bk leading-none tracking-tight">
                  {card.value}
                </p>
                {card.sub && (
                  <p className="text-[11px] font-medium text-primary-dark mt-1.5">
                    {card.sub}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>

        {/* ERP Modules */}
        <section>
          <h2 className="text-[13px] font-semibold text-g400 uppercase tracking-wider mb-3">
            ERP — Облік
          </h2>
          <div className="grid gap-2 sm:gap-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleModules.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 bg-white rounded-[var(--radius-card)] border border-g200 px-3.5 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:border-g300 transition-all group"
              >
                <div className="w-9 h-9 rounded-[var(--radius-btn)] bg-bk flex items-center justify-center flex-shrink-0 text-primary [&>svg]:w-[18px] [&>svg]:h-[18px]">
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[13px] font-semibold text-bk truncate leading-tight">
                    {item.title}
                  </h3>
                  <p className="text-[11px] text-g400 truncate hidden sm:block mt-0.5">
                    {item.desc}
                  </p>
                </div>
                <svg
                  className="w-4 h-4 flex-shrink-0 text-g300 group-hover:text-g400 transition-colors"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="mt-8 px-6 py-5 border-t border-g200">
        <div className="max-w-7xl mx-auto">
          <p className="text-[12px] text-g400">
            Budvik — Панель управління
          </p>
        </div>
      </footer>
    </div>
  );
}
