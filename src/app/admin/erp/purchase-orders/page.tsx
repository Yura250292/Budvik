"use client";

import { useSession } from "next-auth/react";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { formatPrice, formatDate, formatDocDate } from "@/lib/utils";
import { TableScroll } from "@/components/ui/TableScroll";
import { PeriodPicker, type Period, kyivToday } from "@/components/ui/PeriodPicker";

/**
 * Прихід: надходження товару від постачальників.
 *
 * Головне джерело — обмін з 1С (канал purchase_doc). Документи, набрані на
 * сайті, лишаються для випадків поза 1С, і в списку вони позначені окремо:
 * без цієї позначки два походження з різними правилами редагування виглядали
 * б одним списком.
 *
 * Період за замовчуванням — поточний місяць. Без нього список тягнув би всю
 * історію надходжень: це тисячі документів, з яких на екран потрапляли б
 * перші 300 без жодної підказки, що решта існує.
 *
 * Suspense обов'язковий: сторінка читає useSearchParams (посилання з картки
 * контрагента приходить із ?supplierId=), а без межі очікування Next вимагає
 * рендерити її повністю динамічно.
 */

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Чернетка",
  CONFIRMED: "Підтверджено",
  CANCELLED: "Скасовано",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-g100 text-g600",
  CONFIRMED: "bg-green-50 text-green-700",
  CANCELLED: "bg-red-50 text-red-600",
};

type Row = {
  id: string;
  number: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  externalId: string | null;
  currencyCode: string | null;
  supplier: { id: string; name: string } | null;
  stockLocation: { id: string; name: string } | null;
  createdBy: { id: string; name: string | null } | null;
  _count: { items: number };
};

type ListResponse = {
  items: Row[];
  summary: { count: number; total: number; suppliers: number };
  truncated: boolean;
};

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  });

export default function PurchaseOrdersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-g300 border-t-bk motion-reduce:animate-none" />
        </div>
      }
    >
      <PurchaseOrdersList />
    </Suspense>
  );
}

function PurchaseOrdersList() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const role = session?.user?.role;
  const allowed = role === "ADMIN" || role === "MANAGER";

  const [period, setPeriod] = useState<Period>({
    from: `${kyivToday().slice(0, 7)}-01`,
    to: kyivToday(),
  });
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  // Постачальник може приїхати посиланням із картки контрагента.
  const [supplierId, setSupplierId] = useState(searchParams.get("supplierId") ?? "");
  const [stockLocationId, setStockLocationId] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");

  // Пошук за номером із затримкою: інакше кожна цифра — окремий запит по
  // таблиці документів.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ from: period.from, to: period.to });
    if (status) p.set("status", status);
    if (source) p.set("source", source);
    if (supplierId) p.set("supplierId", supplierId);
    if (stockLocationId) p.set("stockLocationId", stockLocationId);
    if (q) p.set("q", q);
    return p.toString();
  }, [period, status, source, supplierId, stockLocationId, q]);

  const { data, isLoading, error } = useSWR<ListResponse>(
    allowed ? `/api/erp/purchase-orders?${query}` : null,
    fetcher
  );
  const { data: suppliers } = useSWR<Array<{ id: string; name: string }>>(
    allowed ? "/api/erp/purchase-orders?facet=suppliers" : null,
    fetcher
  );
  const { data: locations } = useSWR<Array<{ id: string; name: string; isService: boolean }>>(
    allowed ? "/api/admin/stock-locations" : null,
    fetcher
  );

  if (!allowed) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-[#0A0A0A]">Доступ заборонено</h1>
      </div>
    );
  }

  const rows = data?.items ?? [];

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
              <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Прихід</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Надходження товару від постачальників</p>
            </div>
          </div>
          <Link
            href="/admin/erp/purchase-orders/new"
            style={{ background: "#FFD600", color: "#0A0A0A", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", textDecoration: "none" }}
          >
            + Нова накладна
          </Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {/* Період */}
        <div className="mb-4">
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>

        {/* Фільтри */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded-lg border border-g200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Будь-яке джерело</option>
            <option value="1c">З 1С</option>
            <option value="site">Створені на сайті</option>
          </select>

          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="max-w-[260px] rounded-lg border border-g200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Усі постачальники</option>
            {(suppliers ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <select
            value={stockLocationId}
            onChange={(e) => setStockLocationId(e.target.value)}
            className="max-w-[220px] rounded-lg border border-g200 bg-white px-3 py-2 text-sm"
          >
            <option value="">Усі склади</option>
            {(locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Номер накладної"
            className="w-[180px] rounded-lg border border-g200 bg-white px-3 py-2 text-sm"
          />
        </div>

        {/* Статуси окремим рядком: разом із селектами вони переносились так,
            що «Скасовано» опинялось само під фільтрами. */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {["", "DRAFT", "CONFIRMED", "CANCELLED"].map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: 500,
                background: status === s ? "#FFD600" : "white",
                border: `1px solid ${status === s ? "#FFD600" : "#E5E7EB"}`,
                color: "#0A0A0A",
              }}
            >
              {s === "" ? "Всі" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Зведення за фільтром — рахується запитом, а не по видимих рядках */}
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile label="Документів" value={data ? String(data.summary.count) : "…"} />
          <Tile label="Сума" value={data ? formatPrice(data.summary.total) : "…"} />
          <Tile label="Постачальників" value={data ? String(data.summary.suppliers) : "…"} />
        </div>

        {error ? (
          <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{String((error as Error).message)}</div>
        ) : isLoading ? (
          <div className="text-center py-12" style={{ color: "#9E9E9E" }}>Завантаження...</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12">
            <p style={{ color: "#9E9E9E", fontSize: "16px" }}>За цей період надходжень немає</p>
            <p className="mt-1 text-sm text-g400">Розширте період або зніміть фільтри.</p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF", boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }}>
              <TableScroll stickyHeader>
                <table className="w-full">
                  <thead>
                    <tr style={{ background: "#FAFAFA", borderBottom: "1px solid #EFEFEF" }}>
                      <Th>Дата</Th>
                      <Th>Номер</Th>
                      <Th>Постачальник</Th>
                      <Th>Склад</Th>
                      <Th align="center">Позицій</Th>
                      <Th align="right">Сума</Th>
                      <Th align="center">Статус</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((o) => (
                      <tr key={o.id} className="hover:bg-g50 transition-colors" style={{ borderBottom: "1px solid #F3F4F6" }}>
                        <td style={{ padding: "14px 16px", fontSize: "13px", color: "#6B7280", whiteSpace: "nowrap" }}>
                          {/*
                            Дати документів 1С показуємо в UTC (formatDocDate):
                            агент віддає стінний київський час без зсуву, і
                            звичайний formatDate додав би до нього три години —
                            накладна, що в 1С стоїть о 14:29, світилася б о 17:29.
                          */}
                          {o.externalId ? formatDocDate(o.createdAt) : formatDate(o.createdAt)}
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <Link href={`/admin/erp/purchase-orders/${o.id}`} className="text-blue-600 hover:text-blue-800 font-semibold text-sm">
                            {o.number}
                          </Link>
                          <span
                            className="ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium"
                            style={
                              o.externalId
                                ? { background: "#EFF6FF", color: "#2563EB" }
                                : { background: "#F3F4F6", color: "#6B7280" }
                            }
                            title={o.externalId ? "Документ із 1С" : "Створено на сайті"}
                          >
                            {o.externalId ? "1С" : "сайт"}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px", fontSize: "14px", fontWeight: 500, color: "#0A0A0A" }}>
                          {o.supplier?.name ?? "—"}
                        </td>
                        <td style={{ padding: "14px 16px", fontSize: "13px", color: "#6B7280" }}>
                          {o.stockLocation?.name ?? "—"}
                        </td>
                        <td style={{ padding: "14px 16px", textAlign: "center", fontSize: "14px", color: "#6B7280" }}>
                          {o._count?.items}
                        </td>
                        <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>
                          {formatPrice(o.totalAmount)}
                          {o.currencyCode && (
                            <span className="ml-1 text-[11px] font-normal text-g400" title="Документ у валюті, перераховано за курсом 1С">
                              вал.
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "14px 16px", textAlign: "center" }}>
                          <span className={`px-2 py-1 rounded-md text-xs font-medium ${STATUS_COLORS[o.status] ?? "bg-g100 text-g600"}`}>
                            {STATUS_LABELS[o.status] ?? o.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </div>
            {data?.truncated && (
              <p className="mt-3 text-sm text-g400">
                Показано перші {rows.length} із {data.summary.count} — звузьте період або фільтри.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-4" style={{ border: "1px solid #EFEFEF" }}>
      <div className="text-xs text-g400">{label}</div>
      <div className="mt-1 text-xl font-bold text-[#0A0A0A]">{value}</div>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "center" | "right" }) {
  return (
    <th style={{ padding: "12px 16px", textAlign: align, fontSize: "13px", fontWeight: 600, color: "#6B7280", whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}
