"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice, formatDate, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/lib/utils";

export default function OrdersPage() {
  const { data: session } = useSession();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/orders")
      .then((r) => r.json())
      .then((data) => {
        setOrders(data);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-64"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Мої замовлення</h1>

      {orders.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 text-lg mb-4">У вас поки немає замовлень</p>
          <Link href="/catalog" className="bg-orange-600 text-white px-6 py-3 rounded-lg font-semibold">
            Перейти до каталогу
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order: any) => (
            <Link
              key={order.id}
              href={`/dashboard/orders/${order.id}`}
              className="block bg-white border rounded-lg p-6 hover:shadow-md transition"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-semibold text-gray-900">
                      Замовлення #{order.id.slice(-8).toUpperCase()}
                    </span>
                    <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${ORDER_STATUS_COLORS[order.status as keyof typeof ORDER_STATUS_COLORS]}`}>
                      {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS]}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">{formatDate(order.createdAt)}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {order.items.length} товар(ів): {order.items.map((i: any) => i.product.name).join(", ")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-orange-600">{formatPrice(order.totalAmount)}</p>
                  {order.boltsUsed > 0 && (
                    <p className="text-xs text-green-600">Використано {order.boltsUsed} Болтів</p>
                  )}
                  {order.boltsEarned > 0 && (
                    <p className="text-xs text-orange-500">+{order.boltsEarned} Болтів</p>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
