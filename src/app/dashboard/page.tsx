"use client";

import { useSession, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import AiSupportChat from "@/components/ai/AiSupportChat";

export default function DashboardPage() {
  const { data: session } = useSession();
  const [stats, setStats] = useState({ orders: 0, totalSpent: 0, bolts: 0 });

  useEffect(() => {
    if (!session) return;

    fetch("/api/orders")
      .then((r) => r.json())
      .then((orders) => {
        setStats({
          orders: orders.length,
          totalSpent: orders.reduce((s: number, o: any) => s + o.totalAmount, 0),
          bolts: 0,
        });
      });

    fetch("/api/user/bolts")
      .then((r) => r.json())
      .then((data) => {
        setStats((prev) => ({ ...prev, bolts: data.balance }));
      });

  }, [session]);

  if (!session) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-bk mb-4">Увійдіть до свого акаунту</h1>
        <Link href="/login" className="btn-primary inline-block px-6 py-3 text-sm">
          Увійти
        </Link>
      </div>
    );
  }

  const role = (session.user as any).role;

  const menuItems = [
    {
      href: "/catalog",
      title: "Каталог товарів",
      desc: "Переглянути та замовити",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
    },
    {
      href: "/dashboard/orders",
      title: "Мої замовлення",
      desc: "Історія та статуси",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        </svg>
      ),
    },
    {
      href: "/dashboard/loyalty",
      title: "Програма лояльності",
      desc: "Болти та транзакції",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      ),
    },
    {
      href: "/dashboard/wholesale",
      title: role === "WHOLESALE" ? "Оптовий кабінет" : "Стати оптовиком",
      desc: role === "WHOLESALE" ? "Статус та дані компанії" : "Заявка на оптові ціни",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
    },
  ];

  if (role === "SALES") {
    menuItems.unshift({
      href: "/sales",
      title: "Торговий портал",
      desc: "Замовлення, клієнти, комісії",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    });
  }

  if (role === "ADMIN" || role === "SALES") {
    menuItems.push({
      href: "/admin",
      title: "Панель управління",
      desc: "Адмін-панель",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    });
  }

  if (role === "ADMIN") {
    menuItems.push({
      href: "/ai/analytics",
      title: "AI Аналітика",
      desc: "Аналіз продажів",
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    });
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-bk mb-1">
          Вітаємо, {session.user.name}!
        </h1>
        <p className="text-g400 text-sm">
          {role === "ADMIN" ? "Адміністратор" : role === "SALES" ? "Торговий менеджер" : role === "WHOLESALE" ? "Оптовий покупець" : "Клієнт"}
        </p>
      </div>

      {/* Вийти — мобільна кнопка */}
      <button
        onClick={() => signOut({ callbackUrl: "/" })}
        className="mb-6 flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition font-medium md:hidden"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Вийти з акаунту
      </button>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-g200 rounded-xl p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[var(--radius-btn)] bg-g100 flex items-center justify-center">
              <svg className="w-5 h-5 text-g500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-g400">Замовлень</p>
              <p className="text-2xl font-bold text-bk">{stats.orders}</p>
            </div>
          </div>
          <Link href="/dashboard/orders" className="text-primary-dark text-xs hover:underline mt-3 inline-block">
            Переглянути всі
          </Link>
        </div>

        <div className="bg-white border border-g200 rounded-xl p-5 shadow-[var(--shadow-card)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[var(--radius-btn)] bg-g100 flex items-center justify-center">
              <svg className="w-5 h-5 text-g500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-g400">Витрачено</p>
              <p className="text-2xl font-bold text-bk">{formatPrice(stats.totalSpent)}</p>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-bk to-bk-muted rounded-xl p-5 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[var(--radius-btn)] bg-primary/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-primary/80">Болти на балансі</p>
              <p className="text-2xl font-bold text-white">{stats.bolts}</p>
            </div>
          </div>
          <Link href="/dashboard/loyalty" className="text-primary/80 text-xs hover:text-primary mt-3 inline-block transition">
            Деталі програми
          </Link>
        </div>
      </div>

      {/* Функції — gradient section */}
      <div className="bg-gradient-to-br from-g50 to-white border border-g200 rounded-2xl p-6 mb-8 shadow-[var(--shadow-card)]">
        <h2 className="text-lg font-bold text-bk mb-4">Функції кабінету</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {menuItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 bg-white border border-g200 rounded-xl px-3.5 py-3 hover:shadow-md hover:border-primary/40 active:scale-[0.97] transition-[box-shadow,border-color,transform] duration-150 group"
            >
              <div className="w-9 h-9 rounded-[var(--radius-btn)] bg-primary/10 text-primary-dark flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-bk transition-colors">
                {item.icon}
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[13px] text-bk group-hover:text-primary-dark transition-colors leading-tight truncate">
                  {item.title}
                </h3>
                <p className="text-[11px] text-g400 truncate">{item.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* AI Support Chat — gradient section */}
      <div className="bg-gradient-to-br from-bk-soft via-bk-soft to-bk rounded-2xl p-6 shadow-lg">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-9 h-9 rounded-[var(--radius-btn)] bg-primary/20 flex items-center justify-center">
            <svg className="w-4.5 h-4.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">AI Підтримка</h2>
            <p className="text-[11px] text-g400">Запитайте про замовлення, доставку або гарантію</p>
          </div>
        </div>
        <AiSupportChat />
      </div>
    </div>
  );
}
