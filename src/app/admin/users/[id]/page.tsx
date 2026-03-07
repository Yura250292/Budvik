"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { formatPrice, formatDate, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/lib/utils";
import { OrderStatus } from "@prisma/client";

const ALL_STATUSES: OrderStatus[] = ["PENDING", "PAID", "PACKAGING", "IN_TRANSIT", "DELIVERED", "CANCELLED"];

export default function UserProfilePage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"info" | "orders" | "active" | "bolts">("info");

  const role = (session?.user as any)?.role;

  useEffect(() => {
    if (role !== "ADMIN") return;
    fetch(`/api/admin/users/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        setUser(data);
        setLoading(false);
      });
  }, [role, params.id]);

  const changeRole = async (newRole: string) => {
    const label = newRole === "SALES" ? "торговим менеджером" : "клієнтом";
    if (!confirm(`Призначити ${user.name} ${label}?`)) return;

    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });

    if (res.ok) {
      const updated = await res.json();
      setUser((prev: any) => ({ ...prev, role: updated.role }));
    }
  };

  const updateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });

    if (res.ok) {
      setUser((prev: any) => ({
        ...prev,
        orders: prev.orders.map((o: any) =>
          o.id === orderId ? { ...o, status: newStatus } : o
        ),
      }));
    }
  };

  if (role !== "ADMIN") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center text-red-600 font-bold">Доступ заборонено</div>;
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-64 mb-4"></div>
        <div className="h-40 bg-gray-200 rounded mb-4"></div>
        <div className="h-64 bg-gray-200 rounded"></div>
      </div>
    );
  }

  if (!user || user.error) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500 text-lg">Користувача не знайдено</p>
        <Link href="/admin/users" className="text-orange-600 hover:underline mt-2 inline-block">Повернутись</Link>
      </div>
    );
  }

  const roleLabels: Record<string, string> = { ADMIN: "Адміністратор", SALES: "Торговий менеджер", CLIENT: "Клієнт" };
  const roleColors: Record<string, string> = { ADMIN: "bg-red-100 text-red-700", SALES: "bg-blue-100 text-blue-700", CLIENT: "bg-green-100 text-green-700" };

  const activeOrders = user.orders.filter((o: any) => !["DELIVERED", "CANCELLED"].includes(o.status));
  const completedOrders = user.orders.filter((o: any) => ["DELIVERED", "CANCELLED"].includes(o.status));

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Back link */}
      <Link href="/admin/users" className="text-orange-600 hover:underline text-sm mb-4 inline-block">
        &larr; Назад до списку
      </Link>

      {/* Profile header */}
      <div className="bg-white border rounded-xl p-6 mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
              user.role === "ADMIN" ? "bg-red-100" : user.role === "SALES" ? "bg-blue-100" : "bg-gray-100"
            }`}>
              <span className={`font-bold text-2xl ${
                user.role === "ADMIN" ? "text-red-700" : user.role === "SALES" ? "text-blue-700" : "text-gray-700"
              }`}>
                {user.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
              <p className="text-gray-500">{user.email}</p>
              {user.phone && <p className="text-sm text-gray-400">{user.phone}</p>}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className={`px-4 py-2 rounded-full text-sm font-medium ${roleColors[user.role]}`}>
              {roleLabels[user.role]}
            </span>
            {user.role === "CLIENT" && (
              <button
                onClick={() => changeRole("SALES")}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-500 transition"
              >
                Зробити торговим
              </button>
            )}
            {user.role === "SALES" && (
              <button
                onClick={() => changeRole("CLIENT")}
                className="bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-200 transition"
              >
                Зняти роль торгового
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white border rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase mb-1">Замовлень</p>
          <p className="text-2xl font-bold text-gray-900">{user.totalOrders}</p>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase mb-1">Активних</p>
          <p className="text-2xl font-bold text-orange-600">{user.activeOrders}</p>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase mb-1">Витрачено</p>
          <p className="text-2xl font-bold text-gray-900">{formatPrice(user.totalSpent)}</p>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase mb-1">Болти</p>
          <p className="text-2xl font-bold text-orange-600">{user.boltsBalance}</p>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase mb-1">Зареєстрований</p>
          <p className="text-sm font-medium text-gray-700 mt-1">{formatDate(user.createdAt)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b mb-6">
        <div className="flex gap-1">
          {[
            { key: "info", label: "Загальна інформація" },
            { key: "active", label: `Активні замовлення (${activeOrders.length})` },
            { key: "orders", label: `Вся історія (${user.orders.length})` },
            { key: "bolts", label: `Болти (${user.boltsTransactions.length})` },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
                activeTab === tab.key
                  ? "border-orange-600 text-orange-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "info" && (
        <div className="bg-white border rounded-xl p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Контактна інформація</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <label className="text-xs text-gray-400 uppercase">Повне ім&apos;я</label>
              <p className="text-gray-900 font-medium mt-1">{user.name}</p>
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase">Email</label>
              <p className="text-gray-900 font-medium mt-1">{user.email}</p>
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase">Телефон</label>
              <p className="text-gray-900 font-medium mt-1">{user.phone || "Не вказано"}</p>
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase">Роль</label>
              <p className="mt-1">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${roleColors[user.role]}`}>
                  {roleLabels[user.role]}
                </span>
              </p>
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase">Дата реєстрації</label>
              <p className="text-gray-900 font-medium mt-1">{formatDate(user.createdAt)}</p>
            </div>
            <div>
              <label className="text-xs text-gray-400 uppercase">Останнє оновлення</label>
              <p className="text-gray-900 font-medium mt-1">{formatDate(user.updatedAt)}</p>
            </div>
          </div>

          {/* Summary section */}
          <h2 className="text-xl font-bold text-gray-900 mt-8 mb-4">Зведена статистика</h2>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500">Всього замовлень</p>
              <p className="text-2xl font-bold">{user.totalOrders}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500">Загальна сума покупок</p>
              <p className="text-2xl font-bold">{formatPrice(user.totalSpent)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500">Середній чек</p>
              <p className="text-2xl font-bold">
                {user.totalOrders > 0 ? formatPrice(user.totalSpent / user.totalOrders) : "—"}
              </p>
            </div>
          </div>
        </div>
      )}

      {activeTab === "active" && (
        <div>
          {activeOrders.length === 0 ? (
            <div className="bg-white border rounded-lg p-12 text-center text-gray-500">
              Немає активних замовлень
            </div>
          ) : (
            <div className="space-y-4">
              {activeOrders.map((order: any) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onStatusChange={updateOrderStatus}
                  showStatusControl
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "orders" && (
        <div>
          {user.orders.length === 0 ? (
            <div className="bg-white border rounded-lg p-12 text-center text-gray-500">
              Замовлень ще не було
            </div>
          ) : (
            <div className="space-y-4">
              {user.orders.map((order: any) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onStatusChange={updateOrderStatus}
                  showStatusControl={!["DELIVERED", "CANCELLED"].includes(order.status)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "bolts" && (
        <div className="bg-white border rounded-lg">
          <div className="p-4 border-b flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Історія транзакцій Болтів</h2>
            <span className="text-orange-600 font-bold">Баланс: {user.boltsBalance} Болтів</span>
          </div>
          {user.boltsTransactions.length === 0 ? (
            <p className="p-8 text-center text-gray-500">Транзакцій немає</p>
          ) : (
            <div className="divide-y">
              {user.boltsTransactions.map((tx: any) => (
                <div key={tx.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{tx.description}</p>
                    <p className="text-sm text-gray-500">{formatDate(tx.createdAt)}</p>
                  </div>
                  <span className={`font-bold text-lg ${tx.type === "EARNED" ? "text-green-600" : "text-red-500"}`}>
                    {tx.type === "EARNED" ? "+" : ""}{tx.amount} Болтів
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OrderCard({
  order,
  onStatusChange,
  showStatusControl,
}: {
  order: any;
  onStatusChange: (orderId: string, status: OrderStatus) => void;
  showStatusControl: boolean;
}) {
  const ALL_STATUSES: OrderStatus[] = ["PENDING", "PAID", "PACKAGING", "IN_TRANSIT", "DELIVERED", "CANCELLED"];

  return (
    <div className="bg-white border rounded-lg p-5">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-semibold text-gray-900">#{order.id.slice(-8).toUpperCase()}</span>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${ORDER_STATUS_COLORS[order.status as keyof typeof ORDER_STATUS_COLORS]}`}>
              {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS]}
            </span>
          </div>
          <p className="text-sm text-gray-500 mb-2">{formatDate(order.createdAt)}</p>

          {/* Products list */}
          <div className="space-y-1">
            {order.items.map((item: any) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">
                  {item.product.name} <span className="text-gray-400">x{item.quantity}</span>
                </span>
                <span className="text-gray-900 font-medium">{formatPrice(item.price * item.quantity)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 min-w-[160px]">
          <span className="text-xl font-bold text-orange-600">{formatPrice(order.totalAmount)}</span>
          {order.boltsUsed > 0 && (
            <span className="text-xs text-green-600">-{order.boltsUsed} Болтів</span>
          )}
          {order.boltsEarned > 0 && (
            <span className="text-xs text-orange-500">+{order.boltsEarned} кешбек</span>
          )}
          {showStatusControl && (
            <select
              value={order.status}
              onChange={(e) => onStatusChange(order.id, e.target.value as OrderStatus)}
              className="mt-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 w-full"
            >
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  );
}
