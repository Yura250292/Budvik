"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { formatPrice, formatDate, formatDocDate, formatCount, POSITIONS } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { Chip, Page } from "@/components/cabinet/ui";
import { FileText } from "lucide-react";
import { kyivToday } from "@/components/ui/PeriodPicker";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Створено", CONFIRMED: "Підтверджено", PACKING: "На упакуванні",
  IN_TRANSIT: "В дорозі", DELIVERED: "Доставлено", CANCELLED: "Скасовано",
};

/**
 * Підпис статусу для КОНКРЕТНОГО документа.
 *
 * DRAFT означає різне залежно від походження: набране на сайті замовлення,
 * яке торговий ще не підтвердив, — це «Створено», а те саме DRAFT з 1С
 * (externalId є) — це «Не проведено», тобто офіс його ще не провів.
 * Різниця для торгового принципова: перше він може добити сам, друге —
 * тільки чекати, і поки чекає, кількості в документі ще можуть змінитись.
 */
function statusLabel(doc: { status: string; externalId?: string | null }): string {
  if (doc.status === "DRAFT" && doc.externalId) return "Не проведено";
  return STATUS_LABELS[doc.status] ?? doc.status;
}
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
  { key: "DRAFT", label: "Не проведені" },
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
  /** Ref_Key з 1С. Є — документ прийшов обміном, немає — набраний на сайті. */
  externalId?: string | null;
  /** Проведений документ, яким офіс замінив цю чернетку (див. lib/erp/superseded.ts). */
  replacedBy?: { id: string; number: string; totalAmount: number } | null;
  counterparty?: { name: string } | null;
  _count?: { items?: number };
};

/** Стала порожня вибірка: `?? []` давав би новий масив на кожен рендер. */
const NO_ORDERS: Order[] = [];

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

  /**
   * Список у кеші SWR: повернення з картки документа або з сусідньої
   * вкладки більше не починається з порожнього екрана й нового запиту.
   * Ключ — уже зібрана адреса, тож кожен фільтр кешується окремо.
   */
  const listQuery = new URLSearchParams();
  if (status) listQuery.set("status", status);
  const range = periodRange(period);
  if (range) {
    listQuery.set("from", range.from);
    listQuery.set("to", range.to);
  }

  const { data, isLoading } = useSWR<Order[]>(
    `/api/erp/sales?${listQuery}`,
    (url: string) =>
      fetch(url)
        .then((r) => r.json())
        .then((d) => (Array.isArray(d) ? d : [])),
    { dedupingInterval: 60_000, revalidateOnFocus: false, keepPreviousData: true }
  );
  const orders = data ?? NO_ORDERS;
  const loading = isLoading && !data;

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

  // Підсумок рахуємо з уже завантаженого списку — другий запит заради
  // двох чисел не потрібен. Скасовані у суму не йдуть: це не продаж. Так
  // само й непроведені: їхня сума ще може змінитись, коли офіс уріже
  // кількості під залишок, і показувати її як зароблене — обіцяти зайве.
  const counted = useMemo(
    () => orders.filter((o) => o.status !== "CANCELLED" && o.status !== "DRAFT"),
    [orders]
  );
  const total = useMemo(() => counted.reduce((s, o) => s + o.totalAmount, 0), [counted]);

  const periodLabel = PERIOD_FILTERS.find((p) => p.key === period)?.label ?? "";

  return (
    <>
      <SalesHeader title="Мої документи" backTo="/sales" sticky />

      <Page>
        {/* Період */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 scrollbar-hide">
          {PERIOD_FILTERS.map((f) => (
            <span key={f.key} className="shrink-0">
              <Chip active={period === f.key} onClick={() => setFilter({ period: f.key })}>
                {f.label}
              </Chip>
            </span>
          ))}
        </div>

        {/* Статус: дрібніші таблетки — це уточнення до періоду, а не рівний йому вибір */}
        <div className="-mx-4 -mt-1 flex gap-1.5 overflow-x-auto px-4 pb-0.5 scrollbar-hide">
          {STATUS_FILTERS.map((f) => {
            const active = status === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter({ status: f.key })}
                aria-pressed={active}
                className={`min-h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium ${
                  active ? "border-bk bg-bk text-primary" : "border-cab-line bg-white text-cab-t2"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Підсумок за обраний період */}
        {!loading && orders.length > 0 && (
          <div
            className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5"
            style={{ background: "linear-gradient(135deg, #0A0A0A 0%, #1C1C1C 100%)" }}
          >
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-white/40">{periodLabel}</p>
              <p className="text-sm text-white">
                {counted.length} док.
                {counted.length < orders.length && ` + ${orders.length - counted.length} не проведено`}
              </p>
              <p className="text-[11px] text-white/40">без скасованих і не проведених</p>
            </div>
            <p className="shrink-0 text-[22px] font-bold tabular-nums text-primary">
              {formatPrice(total)}
            </p>
          </div>
        )}

        {loading ? (
          <OrdersSkeleton />
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <FileText size={32} className="text-cab-t3" />
            <p className="text-[15px] font-semibold text-bk">
              {period === "today" ? "Сьогодні документів ще немає" : "Документів за цей період немає"}
            </p>
            {period === "today" && (
              <button
                onClick={() => setFilter({ period: "month" })}
                className="text-sm font-semibold text-cab-t2 underline"
              >
                Подивитись за місяць
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {orders.map((o) => (
              <Link
                key={o.id}
                href={`/sales/orders/${o.id}`}
                className="block rounded-2xl border border-cab-line bg-white px-3.5 py-3 active:opacity-70"
                // Кольорова смуга ліворуч — статус, який видно ще до читання:
                // у списку з тридцяти документів очі шукають саме її.
                style={{ borderLeftWidth: "3px", borderLeftColor: STATUS_COLOR[o.status] || "#E5E7EB" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-[15px] font-bold text-bk">{o.number}</span>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                      style={{ background: STATUS_BG[o.status], color: STATUS_COLOR[o.status] }}
                    >
                      {statusLabel(o)}
                    </span>
                  </div>
                  <p className="shrink-0 text-[11px] text-cab-t3">
                    {o.externalId ? formatDocDate(o.createdAt) : formatDate(o.createdAt)}
                  </p>
                </div>

                {/*
                  Назва контрагента окремим рядком над сумою, а не поруч:
                  «ТОВ «Будівельні матеріали Захід»» і шестизначна сума в
                  одному флексі тиснули одне одного до нечитабельного.
                */}
                <p className="mt-1.5 truncate text-sm text-cab-t2">
                  {o.counterparty?.name || "Без клієнта"}
                </p>
                {/* Чернетка, яку офіс провів своїм документом. Без цього рядка
                    дві картки на одну поставку читаються як задвоєння. */}
                {!!o.replacedBy && (
                  <p className="mt-0.5 truncate text-xs font-medium text-[#C2410C]">
                    Замінено №{o.replacedBy.number} · {formatPrice(o.replacedBy.totalAmount)}
                  </p>
                )}
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <p className="text-[11px] text-cab-t3">{formatCount(o._count?.items || 0, POSITIONS)}</p>
                  <p className="text-xl font-bold tabular-nums text-bk">{formatPrice(o.totalAmount)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Page>
    </>
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
