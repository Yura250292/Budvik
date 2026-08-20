"use client";

/**
 * Що шукають — і чого не знаходять.
 *
 * Таблиця «без результатів» стоїть ПЕРШОЮ, хоч і менша: топ запитів
 * лише підтверджує, що люди шукають те, що в нас є, а порожня видача —
 * це прямий список того, що варто завезти або перейменувати в каталозі.
 */

import Link from "next/link";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, num } from "@/components/ui/Stat";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { useApi } from "@/components/ui/useApi";
import { STATUS } from "@/lib/analytics/colors";
import type { Period } from "@/components/ui/PeriodPicker";

interface SearchRow {
  query: string;
  searches: number;
  visitors: number;
  avgResults?: number | null;
  lastAt: string;
}

interface SearchData {
  totals: { searches: number; searchers: number; empty: number; emptyShare: number };
  top: SearchRow[];
  empty: SearchRow[];
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Kyiv",
  }).format(new Date(value));
}

/** Посилання на видачу: власник одразу бачить очима покупця, що не так. */
function QueryLink({ query }: { query: string }) {
  return (
    <Link
      href={`/catalog?search=${encodeURIComponent(query)}`}
      target="_blank"
      className="text-bk underline-offset-2 hover:underline"
    >
      {query}
    </Link>
  );
}

export function SearchTab({ period }: { period: Period }) {
  const { data, loading, error, reload } = useApi<SearchData>(
    `/api/admin/site-analytics/search?from=${period.from}&to=${period.to}`
  );

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <TableSkeleton rows={10} cols={4} />;
  if (!data) return null;

  const t = data.totals;

  if (t.searches === 0) {
    return (
      <Card>
        <EmptyState
          title="Пошуком ще не користувалися"
          hint="Тут з'являться запити з рядка пошуку — і окремо ті, на які каталог нічого не знайшов."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Пошуків" value={num(t.searches)} />
        <StatCard label="Людей шукали" value={num(t.searchers)} />
        <StatCard
          label="Без результату"
          value={num(t.empty)}
          tone={t.emptyShare >= 20 ? "bad" : t.emptyShare >= 10 ? "warn" : "default"}
        />
        <StatCard
          label="Частка невдалих"
          value={`${t.emptyShare.toFixed(1).replace(".", ",")}%`}
          hint="Кожен такий пошук — покупець, що пішов ні з чим"
          tone={t.emptyShare >= 20 ? "bad" : t.emptyShare >= 10 ? "warn" : "default"}
        />
      </div>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Шукали, але не знайшли"
            hint="Каталог повернув нуль товарів. Або такого товару немає, або він названий інакше, ніж його шукають"
            action={
              data.empty.length > 0 ? (
                <span
                  className="rounded-[var(--radius-badge)] px-2 py-0.5 text-xs font-semibold"
                  style={{ color: STATUS.bad.fg, backgroundColor: STATUS.bad.bg }}
                >
                  {data.empty.length}
                </span>
              ) : undefined
            }
          />
        </div>
        {data.empty.length === 0 ? (
          <div className="pb-4">
            <EmptyState
              title="Усі запити щось знаходили"
              hint="Каталог покриває те, що шукають покупці."
            />
          </div>
        ) : (
          <TableScroll minWidth={560} stickyHeader>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs text-g500">
                  <th className="px-4 py-2 font-medium">Запит</th>
                  <th className="px-4 py-2 text-right font-medium">Пошуків</th>
                  <th className="px-4 py-2 text-right font-medium">Людей</th>
                  <th className="px-4 py-2 text-right font-medium">Востаннє</th>
                </tr>
              </thead>
              <tbody>
                {data.empty.map((r) => (
                  <tr key={r.query} className="border-b border-g100 last:border-0">
                    <td className="px-4 py-2.5">
                      <QueryLink query={r.query} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-bk">
                      {num(r.searches)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-g600">{num(r.visitors)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-g500">
                      {formatDate(r.lastAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader title="Найчастіші запити" hint="Що взагалі шукають у каталозі" />
        </div>
        <TableScroll minWidth={620} stickyHeader>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs text-g500">
                <th className="px-4 py-2 font-medium">Запит</th>
                <th className="px-4 py-2 text-right font-medium">Пошуків</th>
                <th className="px-4 py-2 text-right font-medium">Людей</th>
                <th className="px-4 py-2 text-right font-medium">Знаходило</th>
                <th className="px-4 py-2 text-right font-medium">Востаннє</th>
              </tr>
            </thead>
            <tbody>
              {data.top.map((r) => (
                <tr key={r.query} className="border-b border-g100 last:border-0">
                  <td className="px-4 py-2.5">
                    <QueryLink query={r.query} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-bk">
                    {num(r.searches)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-g600">{num(r.visitors)}</td>
                  <td
                    className="px-4 py-2.5 text-right tabular-nums"
                    style={r.avgResults === 0 ? { color: STATUS.bad.mark } : undefined}
                  >
                    {r.avgResults != null ? num(r.avgResults) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-g500">
                    {formatDate(r.lastAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </div>
  );
}
