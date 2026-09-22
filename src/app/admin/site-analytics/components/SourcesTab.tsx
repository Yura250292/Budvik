"use client";

/**
 * «Джерела»: звідки приходять покупці й скільки з них купує.
 *
 * Заради цієї таблиці й робився облік переходів: на Hotline ми платимо за
 * КОЖЕН клік, тож питання «скільки прийшло і скільки купило» — це питання
 * «продовжувати чи вимикати».
 *
 * Колонка «Замовлення» рахується за полем самого замовлення, а не за
 * сесією: покупець із Hotline часто повертається за кілька днів, і в
 * посесійному рахунку така покупка дісталася б «прямим заходам».
 */

import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { num, money } from "@/components/ui/Stat";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { useApi } from "@/components/ui/useApi";
import type { Period } from "@/components/ui/PeriodPicker";

interface SourcesData {
  rows: Array<{
    source: string;
    sessions: number;
    productViews: number;
    addToCarts: number;
    orders: number;
    revenue: number;
    conversion: number;
    avgCheck: number;
  }>;
}

/** Людські назви майданчиків: у базі лежить коротка мітка. */
const TITLES: Record<string, string> = {
  hotline: "Hotline",
  google: "Google",
  bing: "Bing",
  duckduckgo: "DuckDuckGo",
  facebook: "Facebook",
  instagram: "Instagram",
  telegram: "Telegram",
  direct: "Прямі заходи",
  невідомо: "Невідомо",
};

export function SourcesTab({ period, view }: { period: Period; view: "people" | "all" }) {
  const { data, loading, error, reload } = useApi<SourcesData>(
    `/api/admin/site-analytics/sources?from=${period.from}&to=${period.to}&view=${view}`
  );

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <CardSkeleton rows={6} />;
  if (!data) return null;

  if (data.rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="За цей період переходів немає"
          hint="Тут буде видно, скільки людей прийшло з Hotline, Google і напряму — і скільки з них купило."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Звідки приходять покупці"
        hint="Замовлення зараховується джерелу, з якого людина прийшла протягом останніх 30 днів"
      />
      <TableScroll minWidth={720} stickyHeader>
        <table className="w-full text-sm">
          <thead className="text-left text-g600">
            <tr>
              <th className="px-3 py-2 font-medium">Джерело</th>
              <th className="px-3 py-2 text-right font-medium">Візити</th>
              <th className="px-3 py-2 text-right font-medium">Дивилися товар</th>
              <th className="px-3 py-2 text-right font-medium">У кошик</th>
              <th className="px-3 py-2 text-right font-medium">Замовлення</th>
              <th className="px-3 py-2 text-right font-medium">Виручка</th>
              <th className="px-3 py-2 text-right font-medium">Конверсія</th>
              <th className="px-3 py-2 text-right font-medium">Середній чек</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.source} className="border-t border-g100">
                <td className="px-3 py-2.5 font-medium text-bk">{TITLES[r.source] ?? r.source}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{num(r.sessions)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-g600">
                  {num(r.productViews)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-g600">
                  {num(r.addToCarts)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-bk">
                  {num(r.orders)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{money(r.revenue)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.conversion} %</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-g600">
                  {r.orders > 0 ? money(r.avgCheck) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}
