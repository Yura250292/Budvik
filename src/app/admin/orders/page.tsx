"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice, formatDate, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from "@/lib/utils";
import { OrderStatus } from "@prisma/client";

const ALL_STATUSES: OrderStatus[] = ["PENDING", "PAID", "PACKAGING", "IN_TRANSIT", "DELIVERED", "CANCELLED"];

const STATUS_DOT_COLORS: Record<OrderStatus, string> = {
  PENDING: "#B8860B",
  PAID: "#1565C0",
  PACKAGING: "#7C3AED",
  IN_TRANSIT: "#E65100",
  DELIVERED: "#2E7D32",
  CANCELLED: "#C62828",
};

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
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <div className="w-14 h-14 bg-[#FFEAEA] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-[#C62828]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-bk">Доступ заборонено</h1>
        <p className="text-g400 mt-2 text-sm">У вас немає доступу до цієї сторінки</p>
      </div>
    );
  }

  const activeCount = orders.filter((o) => !["DELIVERED", "CANCELLED"].includes(o.status)).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-g200 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Link
              href="/admin"
              className="w-9 h-9 rounded-[var(--radius-btn)] bg-g100 hover:bg-g200 flex items-center justify-center flex-shrink-0 transition-colors"
            >
              <svg className="w-4 h-4 text-g600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-bk leading-tight">Замовлення</h1>
              <p className="text-xs text-g400">
                {orders.length} всього{activeCount > 0 ? ` / ${activeCount} активних` : ""}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-8">
        {/* Filter tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-3 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
          <button
            onClick={() => setFilterStatus("ALL")}
            className={`flex-shrink-0 px-3.5 py-2 rounded-[var(--radius-btn)] text-[13px] font-medium transition-all ${
              filterStatus === "ALL"
                ? "bg-bk text-white shadow-sm"
                : "bg-white text-g500 border border-g200 hover:border-g300"
            }`}
          >
            Усі
            <span className={`ml-1.5 text-[11px] ${filterStatus === "ALL" ? "text-white/60" : "text-g400"}`}>
              {orders.length}
            </span>
          </button>
          {ALL_STATUSES.map((status) => {
            const count = orders.filter((o) => o.status === status).length;
            return (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-[var(--radius-btn)] text-[13px] font-medium transition-all ${
                  filterStatus === status
                    ? "bg-bk text-white shadow-sm"
                    : "bg-white text-g500 border border-g200 hover:border-g300"
                }`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: filterStatus === status ? "white" : STATUS_DOT_COLORS[status] }}
                />
                {ORDER_STATUS_LABELS[status]}
                <span className={`text-[11px] ${filterStatus === status ? "text-white/60" : "text-g400"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-[var(--radius-card)] border border-g200 p-4 sm:p-5 animate-pulse">
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-4 w-20 bg-g200 rounded" />
                  <div className="h-5 w-24 bg-g200 rounded-full" />
                </div>
                <div className="h-3 w-48 bg-g200 rounded mb-2" />
                <div className="h-3 w-64 bg-g200 rounded" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 bg-g100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-g400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <p className="text-sm text-g400 font-medium">Замовлень не знайдено</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((order: any) => (
              <div
                key={order.id}
                className="bg-white rounded-[var(--radius-card)] border border-g200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-shadow"
              >
                <div className="p-4 sm:p-5">
                  {/* Top row: ID + status + price */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-sm font-bold text-bk tracking-wide font-mono">
                        #{order.id.slice(-8).toUpperCase()}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide ${ORDER_STATUS_COLORS[order.status as keyof typeof ORDER_STATUS_COLORS]}`}>
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: STATUS_DOT_COLORS[order.status as OrderStatus] }}
                        />
                        {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS]}
                      </span>
                    </div>
                    <span className="text-base sm:text-lg font-bold text-bk whitespace-nowrap">
                      {formatPrice(order.totalAmount)}
                    </span>
                  </div>

                  {/* Info rows */}
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[13px]">
                      <svg className="w-3.5 h-3.5 text-g400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      <span className="text-g500">
                        <span className="font-medium text-g600">{order.user?.name}</span>
                        <span className="text-g400 ml-1 hidden sm:inline">{order.user?.email}</span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[13px]">
                      <svg className="w-3.5 h-3.5 text-g400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="text-g400">{formatDate(order.createdAt)}</span>
                    </div>
                    <div className="flex items-start gap-2 text-[13px]">
                      <svg className="w-3.5 h-3.5 text-g400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                      </svg>
                      <span className="text-g500 line-clamp-2">
                        {order.items.map((i: any) => `${i.product.name} \u00d7${i.quantity}`).join(", ")}
                      </span>
                    </div>
                  </div>

                  {/* Status changer */}
                  {order.status !== "DELIVERED" && order.status !== "CANCELLED" && (
                    <div className="mt-3 pt-3 border-t border-g200">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-g400 font-medium">Змінити статус:</span>
                        <select
                          value={order.status}
                          onChange={(e) => updateStatus(order.id, e.target.value as OrderStatus)}
                          className="flex-1 max-w-[200px] bg-g50 border border-g200 rounded-[var(--radius-btn)] px-3 py-1.5 text-[13px] text-bk font-medium focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors appearance-none cursor-pointer"
                          style={{
                            backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%239E9E9E' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
                            backgroundPosition: "right 8px center",
                            backgroundRepeat: "no-repeat",
                            backgroundSize: "16px",
                            paddingRight: "32px",
                          }}
                        >
                          {ALL_STATUSES.map((s) => (
                            <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
