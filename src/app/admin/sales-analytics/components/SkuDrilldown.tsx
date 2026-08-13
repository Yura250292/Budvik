"use client";

import { useMemo, useState } from "react";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { money, num } from "@/components/ui/Stat";
import { TableSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";

/**
 * Провалювання в SKU: ширина асортименту по клієнтах.
 *
 * Відповідає на питання «де торговий продає 30 позицій, а де роками ті самі
 * 3–4». Рядок клієнта розгортається в перелік куплених товарів — видно, ЩО
 * саме він бере, і що йому ще не пропонували.
 */

type ClientsResponse = {
  period: { days: number; from: string; to: string };
  clients: Array<{
    id: string;
    name: string;
    sku: number;
    docs: number;
    linesPerDoc: number;
    amount: number;
    repName: string | null;
  }>;
};

type ProductsResponse = {
  products: Array<{
    name: string;
    code: string | null;
    brand: string | null;
    qty: number;
    amount: number;
    docs: number;
  }>;
};

type SortKey = "sku-desc" | "sku-asc" | "amount-desc";

const SORTS: Array<{ key: SortKey; label: string; hint: string }> = [
  { key: "sku-asc", label: "Вузький асортимент", hint: "кандидати на розпрацювання" },
  { key: "sku-desc", label: "Широкий асортимент", hint: "еталонні клієнти" },
  { key: "amount-desc", label: "За оборотом", hint: "найбільші спочатку" },
];

/** Розгорнутий рядок: товари клієнта. Вантажиться лише після відкриття. */
function ClientProducts({ url }: { url: string }) {
  const { data, loading, error, reload } = useApi<ProductsResponse>(url);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton className="h-24 w-full" />;
  if (!data || data.products.length === 0) return <EmptyState title="Немає позицій за період" />;

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-g400">
          <th className="py-1 pr-3 font-medium">Товар</th>
          <th className="py-1 pr-3 font-medium">Бренд</th>
          <th className="py-1 pr-3 text-right font-medium">К-сть</th>
          <th className="py-1 pr-3 text-right font-medium">Док.</th>
          <th className="py-1 text-right font-medium">Сума, грн</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-g100">
        {data.products.map((p, i) => (
          <tr key={i}>
            <td className="py-1.5 pr-3 text-g600">
              {p.name}
              {p.code && <span className="ml-1.5 text-g400">{p.code}</span>}
            </td>
            <td className="py-1.5 pr-3 text-g500">{p.brand ?? "—"}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums text-g600">{num(p.qty)}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums text-g500">{num(p.docs)}</td>
            <td className="py-1.5 text-right font-medium tabular-nums text-bk">{money(p.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SkuDrilldown({ period, rep }: { period: Period; rep: string }) {
  const baseParams = `from=${period.from}&to=${period.to}${rep ? `&rep=${rep}` : ""}`;
  const { data, loading, error, reload } = useApi<ClientsResponse>(`/api/admin/sales-analytics/sku?${baseParams}`);

  const [sort, setSort] = useState<SortKey>("sku-asc");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = (data?.clients ?? []).filter((c) => !q || c.name.toLowerCase().includes(q));
    return [...filtered].sort((a, b) => {
      if (sort === "sku-desc") return b.sku - a.sku || b.amount - a.amount;
      if (sort === "sku-asc") return a.sku - b.sku || b.amount - a.amount;
      return b.amount - a.amount;
    });
  }, [data, sort, query]);

  // Чи показувати колонку торгового: коли обрано конкретного — вона зайва.
  const showRep = !rep && rows.some((r) => r.repName);

  if (error) return <ErrorBox message={error} onRetry={reload} />;

  return (
    <Card padded={false}>
      <div className="p-4 sm:p-5">
        <CardHeader
          title="SKU по клієнтах"
          hint="Скільки різних товарів купує клієнт за період. Клік по рядку — перелік товарів."
        />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              title={s.hint}
              className={`cursor-pointer rounded-[var(--radius-btn)] border px-3 py-1.5 text-xs font-medium transition-colors ${
                sort === s.key
                  ? "border-bk bg-bk text-white"
                  : "border-g200 bg-white text-g600 hover:border-g300"
              }`}
            >
              {s.label}
            </button>
          ))}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Пошук клієнта…"
            className="ml-auto w-44 rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-xs text-bk placeholder:text-g400 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
          />
        </div>
      </div>

      {loading && !data ? (
        <div className="p-4 sm:p-5">
          <TableSkeleton rows={6} cols={5} />
        </div>
      ) : rows.length === 0 ? (
        <div className="p-4 sm:p-5">
          <EmptyState
            title="Немає клієнтів за період"
            hint={query ? "Нічого не знайдено за пошуком." : "Спробуйте розширити період або зняти фільтр торгового."}
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                <th className="px-4 py-2.5">Клієнт</th>
                {showRep && <th className="px-4 py-2.5">Торговий</th>}
                <th className="px-4 py-2.5 text-right">SKU</th>
                <th className="px-4 py-2.5 text-right">Док.</th>
                <th className="px-4 py-2.5 text-right">Поз./док.</th>
                <th className="px-4 py-2.5 text-right">Оборот, грн</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-g100">
              {rows.map((c) => {
                const isOpen = openId === c.id;
                const cols = showRep ? 6 : 5;
                return [
                  <tr
                    key={c.id}
                    onClick={() => setOpenId(isOpen ? null : c.id)}
                    aria-expanded={isOpen}
                    className={`cursor-pointer transition-colors ${isOpen ? "bg-g50" : "hover:bg-g50"}`}
                  >
                    <td className="px-4 py-2.5">
                      <span aria-hidden className="mr-2 inline-block w-3 text-g400">
                        {isOpen ? "▾" : "▸"}
                      </span>
                      <span className="font-medium text-bk">{c.name}</span>
                    </td>
                    {showRep && <td className="px-4 py-2.5 text-xs text-g500">{c.repName ?? "—"}</td>}
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-bk">{num(c.sku)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-g600">{num(c.docs)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-g600">{num(c.linesPerDoc, 1)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-g600">{money(c.amount)}</td>
                  </tr>,
                  isOpen ? (
                    <tr key={`${c.id}-products`}>
                      <td colSpan={cols} className="bg-g50/60 px-4 pb-4 pt-1 sm:px-6">
                        <ClientProducts url={`/api/admin/sales-analytics/sku?${baseParams}&client=${c.id}`} />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.clients.length >= 500 && (
        <p className="border-t border-g100 px-4 py-3 text-xs text-g500 sm:px-5">
          Показано перші 500 клієнтів. Звузьте період або оберіть торгового, щоб побачити решту.
        </p>
      )}
    </Card>
  );
}
