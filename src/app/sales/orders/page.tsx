"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { kyivToday } from "@/components/ui/PeriodPicker";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Створено", CONFIRMED: "Підтверджено", PACKING: "На упакуванні",
  IN_TRANSIT: "В дорозі", DELIVERED: "Доставлено", CANCELLED: "Скасовано",
};
const STATUS_BG: Record<string, string> = {
  DRAFT: "#FFF7ED", CONFIRMED: "#EFF6FF", PACKING: "#FDF4FF",
  IN_TRANSIT: "#FFFBEB", DELIVERED: "#F0FDF4", CANCELLED: "#FEF2F2",
};
const STATUS_COLOR: Record<string, string> = {
  DRAFT: "#D97706", CONFIRMED: "#2563EB", PACKING: "#9333EA",
  IN_TRANSIT: "#D97706", DELIVERED: "#16A34A", CANCELLED: "#DC2626",
};

/**
 * Статусів у схемі шість, у чіпах — п'ять. «Пакування» прибрано з
 * фільтра: на телефоні сім чіпів переносяться у два ряди і з'їдають
 * екран, а сам статус видно в картці кольором і підписом.
 */
const STATUS_FILTERS = [
  { key: "", label: "Всі статуси" },
  { key: "DRAFT", label: "Створені" },
  { key: "CONFIRMED", label: "Підтверджені" },
  { key: "IN_TRANSIT", label: "В дорозі" },
  { key: "DELIVERED", label: "Доставлені" },
];

type PeriodKey = "today" | "week" | "month" | "all";

const PERIOD_FILTERS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "Сьогодні" },
  { key: "week", label: "Тиждень" },
  { key: "month", label: "Місяць" },
  { key: "all", label: "Всі" },
];

/** Період → межі у форматі YYYY-MM-DD. null — без обмеження. */
function periodRange(key: PeriodKey): { from: string; to: string } | null {
  const today = kyivToday();
  if (key === "all") return null;
  if (key === "today") return { from: today, to: today };
  if (key === "month") return { from: `${today.slice(0, 7)}-01`, to: today };

  // Тиждень — останні 7 днів включно з сьогоднішнім, а не з понеділка:
  // торговому важливо «скільки я зробив за тиждень роботи», а не
  // календарна межа, яка в понеділок обнуляла б екран у нуль.
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 6);
  return { from: d.toISOString().slice(0, 10), to: today };
}

type Order = {
  id: string;
  number: string;
  status: string;
  createdAt: string;
  totalAmount: number;
  counterparty?: { name: string } | null;
  _count?: { items?: number };
};

function OrdersSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-g200 bg-white p-4">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="mt-3 flex items-end justify-between">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-6 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Orders() {
  const router = useRouter();
  const params = useSearchParams();

  // Стан фільтрів у query, а не в useState: повернення з картки
  // документа має показати той самий список, а не скинути на «Сьогодні».
  const period = (params.get("period") as PeriodKey) || "today";
  const status = params.get("status") || "";

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const setFilter = (next: { period?: PeriodKey; status?: string }) => {
    const p = new URLSearchParams(params.toString());
    const nextPeriod = next.period ?? period;
    const nextStatus = next.status ?? status;

    if (nextPeriod === "today") p.delete("period");
    else p.set("period", nextPeriod);

    if (nextStatus) p.set("status", nextStatus);
    else p.delete("status");

    const qs = p.toString();
    router.replace(qs ? `?${qs}` : "/sales/orders", { scroll: false });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    const range = periodRange(period);
    if (range) {
      qs.set("from", range.from);
      qs.set("to", range.to);
    }

    fetch(`/api/erp/sales?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setOrders(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [period, status]);

  // Підсумок рахуємо з уже завантаженого списку — другий запит заради
  // двох чисел не потрібен. Скасовані у суму не йдуть: це не продаж.
  const total = useMemo(
    () => orders.filter((o) => o.status !== "CANCELLED").reduce((s, o) => s + o.totalAmount, 0),
    [orders]
  );

  const periodLabel = PERIOD_FILTERS.find((p) => p.key === period)?.label ?? "";

  return (
    <div className="min-h-screen bg-background">
      <SalesHeader title="Мої документи" backTo="/sales" sticky />

      <div className="mx-auto max-w-lg px-4 pt-3">
        {/* Період */}
        <div className="-mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide">
          {PERIOD_FILTERS.map((f) => {
            const active = period === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter({ period: f.key })}
                aria-pressed={active}
                style={{
                  padding: "8px 16px", borderRadius: "12px", fontSize: "13px", fontWeight: 600,
                  whiteSpace: "nowrap", border: "none", minHeight: "40px",
                  background: active ? "linear-gradient(135deg, #FFD600, #FFA000)" : "white",
                  color: active ? "#0A0A0A" : "#6B7280",
                  boxShadow: active ? "0 2px 8px rgba(255,214,0,0.35)" : "0 1px 3px rgba(0,0,0,0.06)",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Статус */}
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-hide">
          {STATUS_FILTERS.map((f) => {
            const active = status === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter({ status: f.key })}
                aria-pressed={active}
                style={{
                  padding: "7px 14px", borderRadius: "10px", fontSize: "12px", fontWeight: 600,
                  whiteSpace: "nowrap", minHeight: "36px",
                  background: active ? "#0A0A0A" : "transparent",
                  color: active ? "#FFD600" : "#9CA3AF",
                  border: active ? "1px solid #0A0A0A" : "1px solid #E5E7EB",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Підсумок за обраний період */}
        {!loading && orders.length > 0 && (
          <div
            className="mb-3 flex items-center justify-between rounded-2xl px-4 py-3"
            style={{ background: "linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 100%)" }}
          >
            <div>
              <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "1px" }}>
                {periodLabel}
              </p>
              <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)" }}>
                {orders.length} док.
              </p>
            </div>
            <p className="tabular-nums" style={{ fontSize: "22px", fontWeight: 700, color: "#FFD600" }}>
              {formatPrice(total)}
            </p>
          </div>
        )}

        {loading ? (
          <OrdersSkeleton />
        ) : orders.length === 0 ? (
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: "#F3F4F6" }}>
              <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="#9CA3AF" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </div>
            <p style={{ color: "#6B7280", fontSize: "15px" }}>
              {period === "today" ? "Сьогодні документів ще немає" : "Документів за цей період немає"}
            </p>
            {period === "today" && (
              <button
                onClick={() => setFilter({ period: "month" })}
                className="mt-3 text-sm font-semibold"
                style={{ color: "#6B7280", textDecoration: "underline" }}
              >
                Подивитись за місяць
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <Link
                key={o.id}
                href={`/sales/orders/${o.id}`}
                className="block rounded-2xl bg-white p-4"
                style={{
                  border: "1px solid #EFEFEF",
                  borderLeftWidth: "3px",
                  borderLeftColor: STATUS_COLOR[o.status] || "#E5E7EB",
                  textDecoration: "none",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                }}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0" style={{ fontSize: "15px", fontWeight: 700, color: "#0A0A0A" }}>
                      {o.number}
                    </span>
                    <span
                      className="shrink-0"
                      style={{
                        fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "6px",
                        background: STATUS_BG[o.status], color: STATUS_COLOR[o.status],
                      }}
                    >
                      {STATUS_LABELS[o.status]}
                    </span>
                  </div>
                  <p className="shrink-0" style={{ fontSize: "11px", color: "#9CA3AF" }}>
                    {formatDate(o.createdAt)}
                  </p>
                </div>

                {/*
                  Назва контрагента окремим рядком над сумою, а не поруч:
                  «ТОВ «Будівельні матеріали Захід»» і шестизначна сума в
                  одному флексі тиснули одне одного до нечитабельного.
                */}
                <p className="truncate" style={{ fontSize: "14px", color: "#6B7280" }}>
                  {o.counterparty?.name || "Без клієнта"}
                </p>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <p style={{ fontSize: "11px", color: "#9CA3AF" }}>{o._count?.items || 0} позицій</p>
                  <p className="tabular-nums" style={{ fontSize: "20px", fontWeight: 700, color: "#0A0A0A" }}>
                    {formatPrice(o.totalAmount)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function OrdersPage() {
  // Suspense обов'язковий: фільтри читаються з useSearchParams.
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-lg px-4 pt-3">
          <OrdersSkeleton />
        </div>
      }
    >
      <Orders />
    </Suspense>
  );
}
