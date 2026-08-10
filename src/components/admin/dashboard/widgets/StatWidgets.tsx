"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminIcon, type IconKey } from "../../icons";

type Counts = {
  orders: number;
  activeOrders: number;
  products: number;
  clients: number;
  wholesale: number;
  pendingWholesale: number;
};

const EMPTY: Counts = { orders: 0, activeOrders: 0, products: 0, clients: 0, wholesale: 0, pendingWholesale: 0 };

let cache: { data: Counts; at: number } | null = null;
let inflight: Promise<Counts> | null = null;

/**
 * Лічильники тягнуться один раз на всі стат-віджети: кожен віджет окремо
 * бив би по тих самих чотирьох ендпоінтах.
 */
async function loadCounts(withUsers: boolean): Promise<Counts> {
  if (cache && Date.now() - cache.at < 60_000) return cache.data;
  if (inflight) return inflight;

  inflight = (async () => {
    const [users, orders, products, wholesaleApps] = await Promise.all([
      withUsers ? fetch("/api/admin/users").then((r) => r.json()).catch(() => []) : Promise.resolve([]),
      fetch("/api/orders").then((r) => r.json()).catch(() => []),
      fetch("/api/products").then((r) => r.json()).catch(() => []),
      fetch("/api/admin/wholesale").then((r) => r.json()).catch(() => []),
    ]);
    const usersList = Array.isArray(users) ? users : [];
    const ordersList = Array.isArray(orders) ? orders : [];
    const appsList = Array.isArray(wholesaleApps) ? wholesaleApps : [];
    const data: Counts = {
      orders: ordersList.length,
      activeOrders: ordersList.filter((o: { status?: string }) => !["DELIVERED", "CANCELLED"].includes(o.status ?? ""))
        .length,
      products: Array.isArray(products) ? products.length : 0,
      clients: usersList.filter((u: { role?: string }) => u.role === "CLIENT").length,
      wholesale: usersList.filter((u: { role?: string }) => u.role === "WHOLESALE").length,
      pendingWholesale: appsList.filter((a: { status?: string }) => a.status === "PENDING").length,
    };
    cache = { data, at: Date.now() };
    inflight = null;
    return data;
  })();

  return inflight;
}

export function useCounts(withUsers: boolean) {
  const [counts, setCounts] = useState<Counts>(cache?.data ?? EMPTY);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let alive = true;
    loadCounts(withUsers)
      .then((data) => {
        if (alive) {
          setCounts(data);
          setLoading(false);
        }
      })
      .catch(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [withUsers]);

  return { counts, loading };
}

function StatTile({
  label,
  value,
  sub,
  href,
  iconKey,
  loading,
}: {
  label: string;
  value: number;
  sub?: string | null;
  href: string;
  iconKey: IconKey;
  loading: boolean;
}) {
  return (
    <Link href={href} className="flex h-full flex-col justify-between p-3.5">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-bk text-primary [&>svg]:h-4 [&>svg]:w-4">
          <AdminIcon name={iconKey} />
        </span>
        <span className="truncate text-[12px] font-medium uppercase tracking-wide text-g400">{label}</span>
      </div>
      <div className="mt-2">
        {loading ? (
          <span className="block h-8 w-16 animate-pulse rounded bg-g100" />
        ) : (
          <p className="text-[28px] font-bold leading-none tracking-tight text-bk tabular-nums">{value}</p>
        )}
        {sub && <p className="mt-1.5 text-[11px] font-medium text-primary-dark">{sub}</p>}
      </div>
    </Link>
  );
}

export function StatOrders({ withUsers }: { withUsers: boolean }) {
  const { counts, loading } = useCounts(withUsers);
  return (
    <StatTile
      label="Замовлення"
      value={counts.orders}
      sub={counts.activeOrders > 0 ? `${counts.activeOrders} активних` : null}
      href="/admin/orders"
      iconKey="orders"
      loading={loading}
    />
  );
}

export function StatProducts({ withUsers }: { withUsers: boolean }) {
  const { counts, loading } = useCounts(withUsers);
  return <StatTile label="Товари" value={counts.products} href="/admin/products" iconKey="products" loading={loading} />;
}

export function StatClients({ withUsers }: { withUsers: boolean }) {
  const { counts, loading } = useCounts(withUsers);
  return <StatTile label="Клієнти" value={counts.clients} href="/admin/users" iconKey="clients" loading={loading} />;
}

export function StatWholesale({ withUsers }: { withUsers: boolean }) {
  const { counts, loading } = useCounts(withUsers);
  return (
    <StatTile
      label="Оптовики"
      value={counts.wholesale}
      sub={counts.pendingWholesale > 0 ? `${counts.pendingWholesale} заявок` : null}
      href="/admin/wholesale"
      iconKey="wholesale"
      loading={loading}
    />
  );
}
