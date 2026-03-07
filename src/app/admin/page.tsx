"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function AdminPage() {
  const { data: session } = useSession();
  const [stats, setStats] = useState({ clients: 0, sales: 0, orders: 0, products: 0, activeOrders: 0 });

  const role = (session?.user as any)?.role;

  useEffect(() => {
    if (role !== "ADMIN" && role !== "SALES") return;

    Promise.all([
      role === "ADMIN" ? fetch("/api/admin/users").then((r) => r.json()) : Promise.resolve([]),
      fetch("/api/orders").then((r) => r.json()),
      fetch("/api/products").then((r) => r.json()),
    ]).then(([users, orders, products]) => {
      const usersList = Array.isArray(users) ? users : [];
      const ordersList = Array.isArray(orders) ? orders : [];
      setStats({
        clients: usersList.filter((u: any) => u.role === "CLIENT").length,
        sales: usersList.filter((u: any) => u.role === "SALES").length,
        orders: ordersList.length,
        activeOrders: ordersList.filter((o: any) => !["DELIVERED", "CANCELLED"].includes(o.status)).length,
        products: Array.isArray(products) ? products.length : 0,
      });
    });
  }, [role]);

  if (role !== "ADMIN" && role !== "SALES") {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-red-600">Доступ заборонено</h1>
        <p className="text-gray-500 mt-2">У вас немає доступу до панелі управління</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Панель управління</h1>
      <p className="text-gray-500 mb-8">
        {role === "ADMIN" ? "Адміністратор" : "Торговий менеджер"}
      </p>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white border rounded-xl p-5">
          <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-1">Замовлень</h3>
          <p className="text-3xl font-bold text-gray-900">{stats.orders}</p>
          <p className="text-xs text-orange-600 mt-1">{stats.activeOrders} активних</p>
        </div>
        <div className="bg-white border rounded-xl p-5">
          <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-1">Товарів</h3>
          <p className="text-3xl font-bold text-gray-900">{stats.products}</p>
        </div>
        {role === "ADMIN" && (
          <>
            <div className="bg-white border rounded-xl p-5">
              <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-1">Клієнтів</h3>
              <p className="text-3xl font-bold text-gray-900">{stats.clients}</p>
            </div>
            <div className="bg-white border rounded-xl p-5">
              <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-1">Торгових</h3>
              <p className="text-3xl font-bold text-blue-600">{stats.sales}</p>
            </div>
          </>
        )}
      </div>

      {/* Navigation cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Link href="/admin/orders" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
          <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <h3 className="font-semibold text-gray-900 group-hover:text-orange-600 mb-1">Замовлення</h3>
          <p className="text-sm text-gray-500">Управління замовленнями та статусами</p>
        </Link>

        {role === "ADMIN" && (
          <>
            <Link href="/admin/products" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 group-hover:text-orange-600 mb-1">Товари</h3>
              <p className="text-sm text-gray-500">Управління каталогом товарів</p>
            </Link>

            <Link href="/admin/users" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 group-hover:text-orange-600 mb-1">Клієнти</h3>
              <p className="text-sm text-gray-500">Профілі, історія замовлень, призначення ролей</p>
            </Link>

            <Link href="/admin/sales" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 group-hover:text-orange-600 mb-1">Торгові менеджери</h3>
              <p className="text-sm text-gray-500">Список торгових, зняття ролі</p>
            </Link>

            <Link href="/admin/integration" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
              <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 group-hover:text-orange-600 mb-1">Інтеграція 1С</h3>
              <p className="text-sm text-gray-500">Імпорт/експорт товарів та замовлень</p>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
