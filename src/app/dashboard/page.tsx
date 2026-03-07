"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";
import AiSupportChat from "@/components/ai/AiSupportChat";
import AiRecommendations from "@/components/ai/AiRecommendations";

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
        <h1 className="text-2xl font-bold mb-4">Увійдіть до свого акаунту</h1>
        <Link href="/login" className="bg-orange-600 text-white px-6 py-3 rounded-lg font-semibold">
          Увійти
        </Link>
      </div>
    );
  }

  const role = (session.user as any).role;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        Вітаємо, {session.user.name}!
      </h1>
      <p className="text-gray-500 mb-8">
        Роль: {role === "ADMIN" ? "Адміністратор" : role === "SALES" ? "Торговий менеджер" : "Клієнт"}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white border rounded-xl p-6">
          <h3 className="text-sm text-gray-500 mb-1">Замовлень</h3>
          <p className="text-3xl font-bold text-gray-900">{stats.orders}</p>
          <Link href="/dashboard/orders" className="text-orange-600 text-sm hover:underline mt-2 inline-block">
            Переглянути
          </Link>
        </div>
        <div className="bg-white border rounded-xl p-6">
          <h3 className="text-sm text-gray-500 mb-1">Витрачено</h3>
          <p className="text-3xl font-bold text-gray-900">{formatPrice(stats.totalSpent)}</p>
        </div>
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl p-6 text-white">
          <h3 className="text-sm opacity-80 mb-1">Болти на балансі</h3>
          <p className="text-3xl font-bold">{stats.bolts}</p>
          <Link href="/dashboard/loyalty" className="text-white text-sm hover:underline mt-2 inline-block opacity-80">
            Деталі
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link href="/catalog" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
          <h3 className="font-semibold text-gray-900 group-hover:text-orange-600 mb-1">Каталог товарів</h3>
          <p className="text-sm text-gray-500">Переглянути та замовити інструменти</p>
        </Link>
        <Link href="/dashboard/orders" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
          <h3 className="font-semibold text-gray-900 group-hover:text-orange-600 mb-1">Мої замовлення</h3>
          <p className="text-sm text-gray-500">Історія та статуси замовлень</p>
        </Link>
        <Link href="/dashboard/loyalty" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
          <h3 className="font-semibold text-gray-900 group-hover:text-orange-600 mb-1">Програма лояльності</h3>
          <p className="text-sm text-gray-500">Баланс Болтів та історія транзакцій</p>
        </Link>
        {(role === "ADMIN" || role === "SALES") && (
          <Link href="/admin" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
            <h3 className="font-semibold text-gray-900 group-hover:text-orange-600 mb-1">Панель управління</h3>
            <p className="text-sm text-gray-500">Адмін-панель та управління</p>
          </Link>
        )}
        <Link href="/ai/wizard" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
          <h3 className="font-semibold text-gray-900 group-hover:text-orange-600 mb-1">AI Підбір інструментів</h3>
          <p className="text-sm text-gray-500">Розумний помічник підбере інструменти під ваші потреби</p>
        </Link>
        {role === "ADMIN" && (
          <Link href="/ai/analytics" className="bg-white border rounded-xl p-6 hover:shadow-md transition group">
            <h3 className="font-semibold text-gray-900 group-hover:text-orange-600 mb-1">AI Аналітика</h3>
            <p className="text-sm text-gray-500">Аналіз продажів та рекомендації</p>
          </Link>
        )}
      </div>

      {/* AI Support Chat */}
      <div className="mt-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">AI Підтримка</h2>
        <AiSupportChat />
      </div>

      {/* AI Personal Recommendations */}
      <AiRecommendations type="personal" title="Рекомендовано для вас" />
    </div>
  );
}
