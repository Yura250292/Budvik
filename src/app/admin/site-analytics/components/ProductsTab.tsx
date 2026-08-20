"use client";

/**
 * Що дивляться і що з цього кладуть у кошик.
 *
 * Колонка «У кошик» разом із конверсією — головне, заради чого вкладка
 * існує: багато переглядів при нулі додавань означає, що з карткою щось
 * не так (ціна, наявність, фото), і це готовий список для роботи.
 */

import Link from "next/link";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { num, money } from "@/components/ui/Stat";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { useApi } from "@/components/ui/useApi";
import { STATUS } from "@/lib/analytics/colors";
import type { Period } from "@/components/ui/PeriodPicker";

interface ProductRow {
  productId: string;
  name: string;
  slug: string | null;
  price: number | null;
  views: number;
  viewers: number;
  carts: number;
  conversion: number;
}

/**
 * Пороги конверсії перегляд→кошик.
 *
 * У роздрібі 5%+ — норма, нижче 2% при помітному трафіку варто дивитися
 * картку. Колір лише супроводжує число, ніколи не заміняє його.
 */
function conversionTone(conversion: number, views: number): string | undefined {
  if (views < 10) return undefined;
  if (conversion >= 5) return STATUS.good.mark;
  if (conversion < 2) return STATUS.bad.mark;
  return undefined;
}

export function ProductsTab({ period }: { period: Period }) {
  const { data, loading, error, reload } = useApi<{ products: ProductRow[] }>(
    `/api/admin/site-analytics/products?from=${period.from}&to=${period.to}`
  );

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <TableSkeleton rows={10} cols={6} />;
  if (!data) return null;

  if (data.products.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Переглядів товарів ще не було"
          hint="Тут з'являться картки, які відкривали покупці, — щойно назбираються перші візити."
        />
      </Card>
    );
  }

  return (
    <Card padded={false}>
      <div className="p-4 sm:p-5">
        <CardHeader
          title="Товари, які дивляться"
          hint="Конверсія — частка переглядів, після яких товар поклали в кошик"
        />
      </div>
      <TableScroll minWidth={720} stickyHeader>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-g200 bg-g50 text-left text-xs text-g500">
              <th className="px-4 py-2 font-medium">Товар</th>
              <th className="px-4 py-2 text-right font-medium">Ціна</th>
              <th className="px-4 py-2 text-right font-medium">Перегляди</th>
              <th className="px-4 py-2 text-right font-medium">Людей</th>
              <th className="px-4 py-2 text-right font-medium">У кошик</th>
              <th className="px-4 py-2 text-right font-medium">Конверсія</th>
            </tr>
          </thead>
          <tbody>
            {data.products.map((p) => {
              const tone = conversionTone(p.conversion, p.views);
              return (
                <tr key={p.productId} className="border-b border-g100 last:border-0">
                  <td className="max-w-[320px] px-4 py-2.5">
                    {p.slug ? (
                      <Link
                        href={`/catalog/${p.slug}`}
                        target="_blank"
                        className="line-clamp-2 text-bk underline-offset-2 hover:underline"
                      >
                        {p.name}
                      </Link>
                    ) : (
                      <span className="line-clamp-2 text-g500">{p.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-g600">
                    {p.price != null ? money(p.price) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-bk">
                    {num(p.views)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-g600">{num(p.viewers)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-bk">{num(p.carts)}</td>
                  <td
                    className="px-4 py-2.5 text-right font-semibold tabular-nums"
                    style={tone ? { color: tone } : undefined}
                  >
                    {p.conversion.toFixed(1).replace(".", ",")}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}
