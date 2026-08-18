"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import useSWR from "swr";
import { OrderStatus } from "@prisma/client";
import { Card, EmptyState } from "@/components/ui/Card";
import { TableScroll } from "@/components/ui/TableScroll";
import {
  formatPrice,
  formatDate,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_COLORS,
  DELIVERY_METHOD_LABELS,
} from "@/lib/utils";
import { hoursSince, shortWait, timeAgo } from "@/lib/relative-time";

const ALL_STATUSES: OrderStatus[] = [
  "PENDING",
  "PAID",
  "PACKAGING",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
];

const STATUS_DOT: Record<OrderStatus, string> = {
  PENDING: "#B8860B",
  PAID: "#1565C0",
  PACKAGING: "#7C3AED",
  IN_TRANSIT: "#E65100",
  DELIVERED: "#2E7D32",
  CANCELLED: "#C62828",
};

/** Скільки годин нове замовлення може лежати без дзвінка, поки це нормально. */
const WARN_HOURS = 2;
const LATE_HOURS = 12;

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  });

type Order = {
  id: string;
  orderNumber: number;
  userId: string | null;
  contactName: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  deliveryMethod: "DELIVERY" | "PICKUP";
  comment: string | null;
  totalAmount: number;
  status: OrderStatus;
  createdAt: string;
  user?: { name: string; email: string } | null;
  items: { id: string; quantity: number; price: number; product: { name: string } }[];
};

type Sort = "new" | "old" | "sum";

/** Наскільки замовлення «горить»: нове й давно без відповіді — червоне. */
function urgency(o: Order): "late" | "warn" | null {
  if (o.status !== "PENDING") return null;
  const h = hoursSince(o.createdAt);
  if (h >= LATE_HOURS) return "late";
  if (h >= WARN_HOURS) return "warn";
  return null;
}

function customerOf(o: Order) {
  return o.contactName || o.user?.name || "—";
}

function destinationOf(o: Order) {
  if (o.deliveryMethod === "PICKUP") return DELIVERY_METHOD_LABELS.PICKUP;
  const addr = [o.city, o.address].filter(Boolean).join(", ");
  return addr || "Адресу не вказано";
}

function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ORDER_STATUS_COLORS[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_DOT[status] }} />
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}

/** Плитка зведення. Клікабельна — веде у відповідний фільтр. */
function Kpi({
  label,
  value,
  hint,
  tone = "plain",
  active,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "plain" | "warn" | "late";
  active?: boolean;
  onClick?: () => void;
}) {
  const toneCls =
    tone === "late"
      ? "border-red-200 bg-red-50"
      : tone === "warn"
        ? "border-[#FFE082] bg-[#FFF8E1]"
        : "border-g200 bg-white";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`rounded-[var(--radius-card)] border p-3 text-left transition-colors duration-150 ${toneCls} ${
        onClick ? "cursor-pointer hover:border-g300" : "cursor-default"
      } ${active ? "ring-2 ring-primary/40" : ""}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wide text-g400">{label}</p>
      <p className="mt-0.5 text-xl font-bold leading-tight text-bk tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-g500">{hint}</p>}
    </button>
  );
}

/**
 * Замовлення з сайту: список для менеджера.
 *
 * Головне питання екрана — «що зараз горить»: нове замовлення без дзвінка
 * старіє, і саме вік, а не порядок у списку, вирішує, за що братись. Тому вік
 * винесено в окрему колонку з порогами, а зведення зверху показує найдовше
 * очікування одним числом.
 *
 * Дані тягне SWR: до цього був голий fetch без catch — будь-який збій лишав
 * сторінку з вічними скелетонами і написом «0 всього», без натяку на помилку.
 */
export default function AdminOrdersPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;

  const { data, error, isLoading, mutate } = useSWR<Order[]>("/api/orders", fetcher, {
    keepPreviousData: true,
    refreshInterval: 60_000,
  });

  const [status, setStatus] = useState<"ALL" | OrderStatus>("ALL");
  const [sort, setSort] = useState<Sort>("new");
  const [q, setQ] = useState("");

  const orders = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const stats = useMemo(() => {
    const pending = orders.filter((o) => o.status === "PENDING");
    const inWork = orders.filter((o) => ["PAID", "PACKAGING", "IN_TRANSIT"].includes(o.status));
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const today = orders.filter((o) => new Date(o.createdAt) >= startOfDay);
    const oldest = pending.reduce<Order | null>(
      (acc, o) => (!acc || new Date(o.createdAt) < new Date(acc.createdAt) ? o : acc),
      null
    );
    return {
      pending,
      inWork,
      today,
      todaySum: today.reduce((s, o) => s + o.totalAmount, 0),
      oldest,
    };
  }, [orders]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = orders.filter((o) => {
      if (status !== "ALL" && o.status !== status) return false;
      if (!needle) return true;
      // Менеджер шукає тим, що має під рукою: номером із дзвінка, прізвищем,
      // телефоном або назвою товару, про який питає клієнт.
      return (
        String(o.orderNumber).includes(needle) ||
        customerOf(o).toLowerCase().includes(needle) ||
        (o.phone ?? "").toLowerCase().includes(needle) ||
        (o.city ?? "").toLowerCase().includes(needle) ||
        (o.address ?? "").toLowerCase().includes(needle) ||
        o.items.some((i) => i.product.name.toLowerCase().includes(needle))
      );
    });
    const byDate = (a: Order, b: Order) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (sort === "old") return [...rows].sort((a, b) => -byDate(a, b));
    if (sort === "sum") return [...rows].sort((a, b) => b.totalAmount - a.totalAmount);
    return [...rows].sort(byDate);
  }, [orders, status, q, sort]);

  const setStatusOf = async (id: string, next: OrderStatus) => {
    // Оптимістично: селект має відгукуватись одразу, а не за пів секунди.
    mutate(
      (prev) => (prev ?? []).map((o) => (o.id === id ? { ...o, status: next } : o)),
      { revalidate: false }
    );
    const res = await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    // Скасування повертає товар на склад — сервер лишається джерелом правди.
    mutate();
    if (!res.ok) alert("Не вдалося змінити статус");
  };

  if (role && !["ADMIN", "MANAGER", "SALES"].includes(role)) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFEAEA]">
          <svg className="h-7 w-7 text-[#C62828]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-bk">Доступ заборонено</h1>
        <p className="mt-2 text-sm text-g400">У вас немає доступу до цієї сторінки</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 pb-10 pt-4 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold leading-tight text-bk sm:text-2xl">Замовлення з сайту</h1>
          <p className="text-xs text-g400">
            {isLoading && !data ? "Завантаження…" : `${orders.length} всього`}
            {stats.inWork.length > 0 && ` · ${stats.inWork.length} в роботі`}
          </p>
        </div>
        <div className="flex items-center gap-2">
        {["ADMIN", "MANAGER"].includes(role) && (
          <Link
            href="/admin/orders/alerts"
            className="flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-2 text-[13px] font-medium text-g600 transition-colors duration-150 hover:bg-g50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            Сповіщення
          </Link>
        )}
        <button
          type="button"
          onClick={() => mutate()}
          className="flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-2 text-[13px] font-medium text-g600 transition-colors duration-150 hover:bg-g50"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Оновити
        </button>
        </div>
      </div>

      {/* Зведення: за що братись просто зараз */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi
          label="Нові — подзвонити"
          value={String(stats.pending.length)}
          hint={stats.pending.length > 0 ? "чекають підтвердження" : "усі опрацьовані"}
          tone={stats.pending.some((o) => urgency(o) === "late") ? "late" : stats.pending.length ? "warn" : "plain"}
          active={status === "PENDING"}
          onClick={() => setStatus(status === "PENDING" ? "ALL" : "PENDING")}
        />
        <Kpi label="У роботі" value={String(stats.inWork.length)} hint="оплачені й у дорозі" />
        <Kpi
          label="Найдовше чекає"
          value={stats.oldest ? shortWait(stats.oldest.createdAt) : "—"}
          hint={stats.oldest ? `№ ${stats.oldest.orderNumber}` : "немає нових"}
          tone={stats.oldest && hoursSince(stats.oldest.createdAt) >= LATE_HOURS ? "late" : "plain"}
        />
        <Kpi
          label="Сьогодні"
          value={String(stats.today.length)}
          hint={stats.todaySum > 0 ? formatPrice(stats.todaySum) : "замовлень ще немає"}
        />
      </div>

      {/* Пошук + сортування */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-g400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Номер, прізвище, телефон, адреса або товар"
            aria-label="Пошук замовлень"
            className="h-10 w-full rounded-[var(--radius-btn)] border border-g200 bg-white pl-9 pr-3 text-[13px] text-bk placeholder-g400 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <label className="sr-only" htmlFor="orders-sort">
          Сортування
        </label>
        <select
          id="orders-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="h-10 cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 text-[13px] font-medium text-bk transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="new">Спершу нові</option>
          <option value="old">Спершу давні</option>
          <option value="sum">За сумою</option>
        </select>
      </div>

      {/* Статуси */}
      <div className="scrollbar-hide -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <button
          type="button"
          onClick={() => setStatus("ALL")}
          className={`flex-shrink-0 cursor-pointer rounded-[var(--radius-btn)] px-3.5 py-2 text-[13px] font-medium transition-colors duration-150 ${
            status === "ALL" ? "bg-bk text-white shadow-sm" : "border border-g200 bg-white text-g500 hover:border-g300"
          }`}
        >
          Усі <span className={status === "ALL" ? "text-white/60" : "text-g400"}>{orders.length}</span>
        </button>
        {ALL_STATUSES.map((s) => {
          const count = orders.filter((o) => o.status === s).length;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`flex flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-[var(--radius-btn)] px-3.5 py-2 text-[13px] font-medium transition-colors duration-150 ${
                status === s ? "bg-bk text-white shadow-sm" : "border border-g200 bg-white text-g500 hover:border-g300"
              }`}
            >
              <span
                className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                style={{ background: status === s ? "white" : STATUS_DOT[s] }}
              />
              {ORDER_STATUS_LABELS[s]}
              <span className={status === s ? "text-white/60" : "text-g400"}>{count}</span>
            </button>
          );
        })}
      </div>

      {error ? (
        <Card>
          <EmptyState
            title="Не вдалося завантажити замовлення"
            hint={String(error.message || error)}
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
              </svg>
            }
          />
          <div className="flex justify-center pb-4">
            <button
              type="button"
              onClick={() => mutate()}
              className="cursor-pointer rounded-[var(--radius-btn)] bg-bk px-4 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
            >
              Спробувати ще раз
            </button>
          </div>
        </Card>
      ) : isLoading && !data ? (
        <div className="space-y-2.5" aria-busy="true" aria-live="polite">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="animate-pulse rounded-[var(--radius-card)] border border-g200 bg-white p-4">
              <div className="mb-3 flex items-center gap-3">
                <div className="h-4 w-20 rounded bg-g200" />
                <div className="h-5 w-24 rounded-full bg-g200" />
              </div>
              <div className="mb-2 h-3 w-48 rounded bg-g200" />
              <div className="h-3 w-64 rounded bg-g200" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            title={orders.length === 0 ? "Замовлень із сайту ще немає" : "Нічого не знайшлося"}
            hint={
              orders.length === 0
                ? "Щойно покупець оформить замовлення, воно зʼявиться тут, а вам прийде сповіщення."
                : "Спробуйте інший запит або зніміть фільтр статусу."
            }
            icon={
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            }
          />
        </Card>
      ) : (
        <>
          {/* Десктоп: щільна таблиця — очима згори вниз по колонці «чекає» */}
          <Card padded={false} className="hidden overflow-hidden lg:block">
            <TableScroll minWidth={980} stickyHeader>
              <table className="w-full text-[13px]">
                <thead className="table-sticky-head">
                  <tr className="bg-g50 text-left text-[11px] uppercase tracking-wide text-g500">
                    <th className="px-3 py-2.5 font-medium">№</th>
                    <th className="px-3 py-2.5 font-medium">Коли</th>
                    <th className="px-3 py-2.5 font-medium">Покупець</th>
                    <th className="px-3 py-2.5 font-medium">Куди</th>
                    <th className="px-3 py-2.5 font-medium">Що замовив</th>
                    <th className="px-3 py-2.5 text-right font-medium">Сума</th>
                    <th className="px-3 py-2.5 font-medium">Статус</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((o) => {
                    const u = urgency(o);
                    const units = o.items.reduce((s, i) => s + i.quantity, 0);
                    return (
                      <tr
                        key={o.id}
                        className={`border-t border-g100 transition-colors duration-150 hover:bg-g50 ${
                          u === "late" ? "bg-red-50/60" : u === "warn" ? "bg-[#FFF8E1]/70" : ""
                        }`}
                      >
                        <td className="whitespace-nowrap px-3 py-3 align-top">
                          <Link
                            href={`/admin/orders/${o.id}`}
                            className="cursor-pointer font-mono font-bold text-bk hover:text-primary-dark hover:underline"
                          >
                            № {o.orderNumber}
                          </Link>
                          {!o.userId && (
                            <span className="ml-1.5 rounded-full bg-g100 px-1.5 py-0.5 text-[10px] font-semibold text-g500">
                              гість
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 align-top">
                          <p className="text-g600">{timeAgo(o.createdAt)}</p>
                          <p className="text-[11px] text-g400">{formatDate(o.createdAt)}</p>
                          {u && (
                            <p
                              className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold ${
                                u === "late" ? "text-red-600" : "text-[#B8860B]"
                              }`}
                            >
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              чекає {shortWait(o.createdAt)}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <p className="font-medium text-bk">{customerOf(o)}</p>
                          {o.phone ? (
                            <a href={`tel:${o.phone}`} className="cursor-pointer text-[12px] text-primary-dark hover:underline">
                              {o.phone}
                            </a>
                          ) : (
                            <span className="text-[12px] text-g400">{o.user?.email ?? "без телефону"}</span>
                          )}
                        </td>
                        <td className="max-w-[220px] px-3 py-3 align-top">
                          <p className="text-g600">
                            {o.deliveryMethod === "PICKUP" ? (
                              <span className="font-medium">Самовивіз</span>
                            ) : (
                              destinationOf(o)
                            )}
                          </p>
                          {o.comment && (
                            <p className="mt-0.5 line-clamp-1 text-[11px] text-g400" title={o.comment}>
                              «{o.comment}»
                            </p>
                          )}
                        </td>
                        <td className="max-w-[280px] px-3 py-3 align-top">
                          <p className="line-clamp-2 text-g600" title={o.items.map((i) => `${i.product.name} ×${i.quantity}`).join("\n")}>
                            {o.items.map((i) => `${i.product.name} ×${i.quantity}`).join(", ")}
                          </p>
                          <p className="text-[11px] text-g400">
                            {o.items.length} поз. · {units} од.
                          </p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right align-top font-bold text-bk tabular-nums">
                          {formatPrice(o.totalAmount)}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <StatusBadge status={o.status} />
                          {o.status !== "DELIVERED" && o.status !== "CANCELLED" && (
                            <select
                              value={o.status}
                              onChange={(e) => setStatusOf(o.id, e.target.value as OrderStatus)}
                              aria-label={`Змінити статус замовлення № ${o.orderNumber}`}
                              className="mt-1.5 block w-full max-w-[150px] cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-g50 px-2 py-1 text-[12px] font-medium text-bk transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                            >
                              {ALL_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {ORDER_STATUS_LABELS[s]}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <Link
                            href={`/admin/orders/${o.id}`}
                            aria-label={`Відкрити замовлення № ${o.orderNumber}`}
                            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[var(--radius-btn)] text-g400 transition-colors duration-150 hover:bg-g100 hover:text-bk"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          </Card>

          {/* Мобільний: та сама інформація картками */}
          <div className="space-y-2.5 lg:hidden">
            {visible.map((o) => {
              const u = urgency(o);
              const units = o.items.reduce((s, i) => s + i.quantity, 0);
              return (
                <div
                  key={o.id}
                  className={`rounded-[var(--radius-card)] border bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${
                    u === "late" ? "border-red-200" : u === "warn" ? "border-[#FFE082]" : "border-g200"
                  }`}
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/orders/${o.id}`} className="cursor-pointer font-mono text-sm font-bold text-bk">
                        № {o.orderNumber}
                      </Link>
                      {!o.userId && (
                        <span className="rounded-full bg-g100 px-1.5 py-0.5 text-[10px] font-semibold text-g500">гість</span>
                      )}
                      <StatusBadge status={o.status} />
                    </div>
                    <span className="whitespace-nowrap text-base font-bold text-bk">{formatPrice(o.totalAmount)}</span>
                  </div>

                  <p className="text-[13px] text-g400">
                    {timeAgo(o.createdAt)}
                    {u && (
                      <span className={`ml-2 font-semibold ${u === "late" ? "text-red-600" : "text-[#B8860B]"}`}>
                        чекає {shortWait(o.createdAt)}
                      </span>
                    )}
                  </p>

                  <p className="mt-1.5 font-medium text-bk">{customerOf(o)}</p>
                  {o.phone && (
                    <a href={`tel:${o.phone}`} className="text-[13px] text-primary-dark">
                      {o.phone}
                    </a>
                  )}
                  <p className="mt-1 text-[13px] text-g500">{destinationOf(o)}</p>
                  <p className="mt-1 line-clamp-2 text-[13px] text-g500">
                    {o.items.map((i) => `${i.product.name} ×${i.quantity}`).join(", ")}
                  </p>
                  <p className="text-[11px] text-g400">
                    {o.items.length} поз. · {units} од.
                  </p>
                  {o.comment && <p className="mt-1 text-[12px] text-g400">«{o.comment}»</p>}

                  <Link
                    href={`/admin/orders/${o.id}`}
                    className="mt-3 flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-[var(--radius-btn)] bg-bk text-[13px] font-medium text-white transition-opacity active:opacity-90"
                  >
                    Відкрити для комплектації
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
