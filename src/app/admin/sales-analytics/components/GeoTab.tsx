"use client";

/**
 * Географія: де ми сильні, а де білі плями.
 *
 * Головна колонка — не оборот, а оборот НА ПОКУПЦЯ: самим оборотом велике
 * місто виграє завжди, і Львів назавжди лишався б «найкращим напрямком».
 * Слабкі міста — там, де клієнти є, а середній чек утричі нижчий за
 * медіану: або ринок не розпрацьований, або туди возять по дрібному.
 */

import { useMemo } from "react";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, money, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { Badge } from "@/components/ui/Badge";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";

type GeoResponse = {
  period: { from: string; to: string };
  cities: Array<{
    city: string;
    buyers: number;
    clients: number;
    amount: number;
    perBuyer: number;
    debt: number;
    withGeo: number;
    repNames: string[];
  }>;
  unknown: { clients: number; buyers: number; amount: number };
  totalAmount: number;
};

/** Мінімум покупців, щоб місто вважалося напрямком, а не одним клієнтом. */
const MIN_BUYERS_FOR_RANKING = 3;

export function GeoTab({ period }: { period: Period }) {
  const { data, loading, error, reload } = useApi<GeoResponse>(
    `/api/admin/sales-analytics/clients/geo?from=${period.from}&to=${period.to}`
  );

  // Медіана обороту на покупця — база для порівняння міст між собою.
  // Медіана, а не середнє: Львів із сотнею покупців перетягнув би середнє.
  const { median, weak } = useMemo(() => {
    const ranked = (data?.cities ?? []).filter((c) => c.buyers >= MIN_BUYERS_FOR_RANKING);
    if (ranked.length === 0) return { median: 0, weak: [] as GeoResponse["cities"] };
    const sorted = [...ranked].map((c) => c.perBuyer).sort((a, b) => a - b);
    const mid = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[(sorted.length - 1) / 2];
    return {
      median: mid,
      weak: ranked.filter((c) => c.perBuyer < mid / 2).sort((a, b) => b.clients - a.clients),
    };
  }, [data]);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <TableSkeleton rows={10} />;
  if (!data) return null;

  if (data.cities.length === 0) {
    return (
      <Card>
        <EmptyState title="Міст не визначено" hint="У клієнтів немає ні міста в назві, ні адреси." />
      </Card>
    );
  }

  const unknownShare = data.totalAmount > 0 ? (data.unknown.amount / data.totalAmount) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Міст із покупцями" value={num(data.cities.filter((c) => c.buyers > 0).length)} hint={`всього визначено ${num(data.cities.length)}`} />
        <StatCard
          label="Медіана на покупця"
          value={money(median)}
          unit="₴"
          hint={`серед міст із ${MIN_BUYERS_FOR_RANKING}+ покупцями`}
        />
        <StatCard
          label="Слабкі напрямки"
          value={num(weak.length)}
          unit="міст"
          tone={weak.length > 0 ? "warn" : "good"}
          hint="оборот на покупця вдвічі нижчий за медіану"
        />
        <StatCard
          label="Місто не визначене"
          value={num(data.unknown.clients)}
          unit="кл."
          tone={unknownShare > 25 ? "warn" : "neutral"}
          hint={`${money(data.unknown.amount)} ₴ · ${num(unknownShare, 0)}% обороту`}
        />
      </div>

      <p className="text-xs text-g500">
        Місто визначається з назви клієнта в дужках («…(м.Радехів)») або з початку
        адреси — окремого поля в 1С немає. Клієнти без жодної підказки зведені в рядок
        «місто не визначене», а не приховані: інакше підсумки не сходились би.
      </p>

      {weak.length > 0 && (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Білі плями"
              hint="Клієнти є, а беруть мало: оборот на покупця вдвічі нижчий за медіану по містах"
            />
          </div>
          <TableScroll stickyHeader minWidth={620}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Місто</th>
                  <th className="px-4 py-2.5 text-right">Покупців</th>
                  <th className="px-4 py-2.5 text-right">На покупця, грн</th>
                  <th className="px-4 py-2.5 text-right">Проти медіани</th>
                  <th className="px-4 py-2.5">Торгові</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {weak.map((c) => (
                  <tr key={c.city}>
                    <td className="px-4 py-3 text-bk">{c.city}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">
                      {num(c.buyers)}
                      {c.clients > c.buyers && (
                        <span className="block text-[11px] text-g400">з {num(c.clients)} відомих</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-bk">
                      {money(c.perBuyer)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Badge status="warn">
                        {median > 0 ? `${num((c.perBuyer / median) * 100, 0)}%` : "—"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-g600">
                      {c.repNames.length > 0 ? c.repNames.join(", ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader title="Усі міста" hint="За оборотом за період" />
        </div>
        <TableScroll stickyHeader minWidth={820}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                <th className="px-4 py-2.5">Місто</th>
                <th className="px-4 py-2.5 text-right">Оборот, грн</th>
                <th className="px-4 py-2.5 text-right">Покупців</th>
                <th className="px-4 py-2.5 text-right">На покупця, грн</th>
                <th className="px-4 py-2.5 text-right">Борг, грн</th>
                <th className="px-4 py-2.5">Торгові</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-g100">
              {data.cities.slice(0, 120).map((c) => (
                <tr key={c.city} className="transition-colors hover:bg-g50">
                  <td className="px-4 py-3 text-bk">{c.city}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                    {money(c.amount)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-g600">{num(c.buyers)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-g600">{money(c.perBuyer)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-g600">
                    {c.debt > 0 ? money(c.debt) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-g600">
                    {c.repNames.length > 0 ? c.repNames.slice(0, 2).join(", ") : "—"}
                  </td>
                </tr>
              ))}
              <tr className="bg-g50">
                <td className="px-4 py-3 text-g600">Місто не визначене</td>
                <td className="px-4 py-3 text-right font-medium tabular-nums text-g600">
                  {money(data.unknown.amount)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-g600">{num(data.unknown.buyers)}</td>
                <td className="px-4 py-3 text-right text-g400">—</td>
                <td className="px-4 py-3 text-right text-g400">—</td>
                <td className="px-4 py-3 text-xs text-g400">немає міста в назві й адресі</td>
              </tr>
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </div>
  );
}
