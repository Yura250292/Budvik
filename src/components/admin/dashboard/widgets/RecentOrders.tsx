"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { money } from "@/components/ui/Stat";

type Order = {
  id: string;
  status?: string;
  total?: number;
  createdAt?: string;
  user?: { name?: string | null } | null;
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Новий",
  CONFIRMED: "Підтверджено",
  PROCESSING: "В обробці",
  SHIPPED: "Відвантажено",
  DELIVERED: "Доставлено",
  CANCELLED: "Скасовано",
};

export default function RecentOrders() {
  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/orders")
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        setOrders(Array.isArray(data) ? data.slice(0, 8) : []);
      })
      .catch(() => alive && setOrders([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-bk">Останні замовлення</h3>
        <Link href="/admin/orders" className="flex-shrink-0 text-[12px] font-medium text-g400 transition-colors hover:text-bk">
          Усі →
        </Link>
      </div>

      {orders === null ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-g100" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-g400">Замовлень поки немає</p>
      ) : (
        <ul className="-mx-1 flex-1 overflow-y-auto">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/admin/orders`}
                className="flex items-center justify-between gap-3 rounded-lg px-1 py-2 transition-colors hover:bg-g50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-bk">
                    {o.user?.name || "Без імені"}
                  </span>
                  <span className="block text-[11px] text-g400">
                    {STATUS_LABEL[o.status ?? ""] ?? o.status ?? "—"}
                  </span>
                </span>
                <span className="flex-shrink-0 text-[13px] font-semibold tabular-nums text-bk">
                  {money(o.total ?? 0)} ₴
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
