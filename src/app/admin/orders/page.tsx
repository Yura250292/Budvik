"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { formatPrice, formatDate, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/lib/utils";
import { OrderStatus } from "@prisma/client";

const ALL_STATUSES: OrderStatus[] = ["PENDING", "PAID", "PACKAGING", "IN_TRANSIT", "DELIVERED", "CANCELLED"];

export default function AdminOrdersPage() {
  const { data: session } = useSession();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  const role = (session?.user as any)?.role;

  useEffect(() => {
    fetch("/api/orders")
      .then((r) => r.json())
      .then((data) => {
        setOrders(data);
        setLoading(false);
      });
  }, []);

  const updateStatus = async (orderId: string, newStatus: OrderStatus) => {
    const res = await fetch(`/api/orders/${orderId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });

    if (res.ok) {
      const updated = await res.json();
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: updated.status } : o)));
    }
  };

  const filtered = filterStatus === "ALL" ? orders : orders.filter((o) => o.status === filterStatus);

  if (role !== "ADMIN" && role !== "SALES") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center text-red-600 font-bold">Доступ заборонено</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-bk mb-6">Управління замовленнями</h1>

      {/* Filter */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setFilterStatus("ALL")}
          className={`px-4 py-2 rounded-full text-sm font-medium transition ${
            filterStatus === "ALL" ? "bg-bk text-white" : "bg-g100 text-g600 hover:bg-g200"
          }`}
        >
          Усі ({orders.length})
        </button>
        {ALL_STATUSES.map((status) => {
          const count = orders.filter((o) => o.status === status).length;
          return (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                filterStatus === status ? "bg-bk text-white" : `${ORDER_STATUS_COLORS[status]} hover:opacity-80`
              }`}
            >
              {ORDER_STATUS_LABELS[status]} ({count})
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-g200 rounded"></div>)}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-g400 text-center py-8">Замовлень не знайдено</p>
      ) : (
        <div className="space-y-4">
          {filtered.map((order: any) => (
            <div key={order.id} className="bg-white border rounded-lg p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-semibold">#{order.id.slice(-8).toUpperCase()}</span>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${ORDER_STATUS_COLORS[order.status as keyof typeof ORDER_STATUS_COLORS]}`}>
                      {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS]}
                    </span>
                  </div>
                  <p className="text-sm text-g400">
                    Клієнт: <span className="font-medium text-g600">{order.user?.name}</span> ({order.user?.email})
                  </p>
                  <p className="text-sm text-g400">{formatDate(order.createdAt)}</p>
                  <p className="text-sm text-g400 mt-1">
                    Товари: {order.items.map((i: any) => `${i.product.name} (x${i.quantity})`).join(", ")}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className="text-xl font-bold text-primary">{formatPrice(order.totalAmount)}</span>
                  {order.status !== "DELIVERED" && order.status !== "CANCELLED" && (
                    <select
                      value={order.status}
                      onChange={(e) => updateStatus(order.id, e.target.value as OrderStatus)}
                      className="border border-g300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ALL_STATUSES.map((s) => (
                        <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
