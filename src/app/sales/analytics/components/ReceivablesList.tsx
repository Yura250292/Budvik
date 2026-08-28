"use client";

import type { ReceivableBucket } from "@prisma/client";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { ColorDot } from "@/components/ui/Badge";
import { money, num } from "@/components/ui/Stat";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { STATUS } from "@/lib/analytics/colors";
import { BUCKET_LABELS, BUCKET_COLORS } from "@/lib/erp/receivables";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { formatDate, useMyReceivables } from "./useSalesAnalytics";

/**
 * Боржники торгового — картками, а не таблицею.
 *
 * У зведеній керівника це таблиця на 640px: там треба порівнювати
 * клієнтів між собою по кількох колонках. Тут завдання інше — «кому
 * дзвонити першим», і для нього достатньо імені, суми й простроченої
 * частини. Таблиця на телефоні вимагала б горизонтального скролу заради
 * трьох чисел.
 */
export function ReceivablesList({ repId }: { repId: string | null }) {
  const { data, loading, error, reload } = useMyReceivables(repId);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <CardSkeleton rows={5} />;
  if (!data) return null;

  if (data.clients.length === 0) {
    return (
      <Card>
        <CardHeader title="Дебіторка" />
        <EmptyState title="Боргів немає" hint="За даними 1С ваші клієнти нічого не винні." />
      </Card>
    );
  }

  const buckets = (Object.keys(BUCKET_LABELS) as ReceivableBucket[]).filter(
    (b) => data.aging.buckets[b] > 0
  );

  return (
    <Card padded={false}>
      <div className="p-4 sm:p-5">
        <CardHeader
          title="Дебіторка"
          hint={
            data.syncedAt
              ? `Сальдо з 1С станом на ${formatDate(data.syncedAt)} — залишок, а не оборот за період.`
              : "Сальдо з 1С — залишок, а не оборот за період."
          }
        />

        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-bk">
            {money(data.aging.total)}
          </span>
          <span className="text-sm text-cab-t2">₴</span>
          {data.aging.overdue > 0 && (
            <span className="ml-auto text-sm font-semibold tabular-nums" style={{ color: STATUS.bad.fg }}>
              прострочено {money(data.aging.overdue)} ({num(data.aging.overdueRatio)}%)
            </span>
          )}
        </div>

        {buckets.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {buckets.map((b) => (
              <span
                key={b}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-badge)] border border-cab-line px-2 py-1 text-xs"
              >
                <ColorDot color={BUCKET_COLORS[b]} size={8} />
                <span className="text-cab-t2">{BUCKET_LABELS[b]}</span>
                <span className="font-semibold tabular-nums text-bk">
                  {money(data.aging.buckets[b])}
                </span>
              </span>
            ))}
          </div>
        )}

        {data.aging.unknown > 0 && (
          <p className="mt-2 text-xs leading-relaxed text-cab-t2">
            Для {money(data.aging.unknown)} грн 1С ще не передала розбивку за строками — цей борг не
            віднесено ні до робочого, ні до простроченого, і у відсоток прострочки він не входить.
          </p>
        )}
      </div>

      <ul className="divide-y divide-[#F1F1EF] border-t border-[#F1F1EF]">
        {data.clients.map((c) => (
          <li key={c.counterpartyId} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-medium text-bk">{c.name}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-bk">
                {money(c.debt)} ₴
              </span>
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-cab-t2">
                {c.lastDocAt ? `остання відвантажка ${formatDate(c.lastDocAt)}` : "відвантажень немає"}
              </span>
              <span className="shrink-0 tabular-nums">
                {c.overdue === null ? (
                  <span className="text-cab-t3" title="1С не передала розбивку за строками">
                    строки невідомі
                  </span>
                ) : c.overdue > 0 ? (
                  <span className="font-semibold" style={{ color: STATUS.bad.fg }}>
                    прострочено {money(c.overdue)}
                  </span>
                ) : (
                  <span style={{ color: STATUS.good.fg }}>у строку</span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
