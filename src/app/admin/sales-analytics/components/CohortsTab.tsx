"use client";

/**
 * Когорти утримання + відтік у грошах.
 *
 * Верх — ціна проблеми (скільки обороту стоїть за тими, хто замовк),
 * середина — таблиця когорт (чи приживаються нові), низ — конкретні
 * клієнти, з яких починати повертати. Розрахунок на сервері
 * (lib/analytics/cohorts.ts), пороги станів — ті самі, що в портфелі.
 */

import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, money, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { Badge } from "@/components/ui/Badge";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";

type CohortsResponse = {
  cohorts: Array<{
    month: string;
    isBaseline: boolean;
    size: number;
    totalRevenue: number;
    activity: number[];
    aliveShare: number;
  }>;
  churn: {
    lost: ChurnBucket;
    dormant: ChurnBucket;
    top: Array<{
      counterpartyId: string;
      name: string;
      repName: string | null;
      state: "LOST" | "DORMANT";
      daysSinceLast: number;
      avgMonthly: number;
      totalRevenue: number;
      docs: number;
      oneOff: boolean;
    }>;
  };
};

type ChurnBucket = {
  clients: number;
  monthlyRevenue: number;
  oneOffClients: number;
  oneOffRevenue: number;
};

/** Колір клітинки утримання: зелений ≥60%, жовтий ≥35%, далі червоний. */
function cellStyle(pct: number): { backgroundColor: string; color: string } {
  if (pct >= 60) return { backgroundColor: "#ECFDF5", color: "#047857" };
  if (pct >= 35) return { backgroundColor: "#FFFBEB", color: "#B45309" };
  return { backgroundColor: "#FEF2F2", color: "#B91C1C" };
}

const MONTH_LABELS = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_LABELS[m - 1]} ${String(y).slice(2)}`;
}

export function CohortsTab() {
  const { data, loading, error, reload } = useApi<CohortsResponse>(
    "/api/admin/sales-analytics/clients/cohorts"
  );

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <TableSkeleton rows={8} />;
  if (!data) return null;

  const { cohorts, churn } = data;
  const maxHorizon = Math.max(...cohorts.map((c) => c.activity.length), 0);
  const newCohorts = cohorts.filter((c) => !c.isBaseline);
  const newTotal = newCohorts.reduce((s, c) => s + c.size, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Втрачені клієнти"
          value={num(churn.lost.clients)}
          unit="кл."
          tone={churn.lost.clients > 0 ? "bad" : "good"}
          hint={
            `постійні давали ~${money(churn.lost.monthlyRevenue)} ₴/міс` +
            (churn.lost.oneOffClients > 0
              ? ` · ще ${num(churn.lost.oneOffClients)} разових на ${money(churn.lost.oneOffRevenue)} ₴`
              : "") +
            " · мовчать 90+ днів"
          }
        />
        <StatCard
          label="Засинають"
          value={num(churn.dormant.clients)}
          unit="кл."
          tone={churn.dormant.clients > 0 ? "warn" : "good"}
          hint={
            `постійні давали ~${money(churn.dormant.monthlyRevenue)} ₴/міс` +
            (churn.dormant.oneOffClients > 0
              ? ` · ще ${num(churn.dormant.oneOffClients)} разових`
              : "") +
            " · мовчать 60–90 днів"
          }
        />
        <StatCard
          label="Нових із лютого"
          value={num(newTotal)}
          unit="кл."
          hint="перша покупка після стартової бази"
        />
        <StatCard
          label="Виживання нових"
          value={
            newCohorts.length > 0
              ? num(
                  newCohorts.reduce((s, c) => s + c.aliveShare * c.size, 0) /
                    Math.max(1, newTotal),
                  0
                )
              : "—"
          }
          unit="%"
          hint="частка нових, активних в останній повний місяць"
        />
      </div>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Утримання когорт"
            hint="Рядок — місяць першої покупки. Клітинки — % клієнтів когорти, активних через N місяців. Січень — стартова база (вся стара клієнтура), нових у ньому не видно."
          />
        </div>
        <TableScroll minWidth={640}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                <th className="px-4 py-2.5">Когорта</th>
                <th className="px-4 py-2.5 text-right">Клієнтів</th>
                <th className="px-4 py-2.5 text-right">Оборот, грн</th>
                {Array.from({ length: maxHorizon }, (_, k) => (
                  <th key={k} className="px-3 py-2.5 text-center">
                    {k === 0 ? "1-й міс" : `+${k}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-g100">
              {cohorts.map((c) => (
                <tr key={c.month}>
                  <td className="px-4 py-2.5 whitespace-nowrap text-bk">
                    {monthLabel(c.month)}
                    {c.isBaseline && (
                      <span className="ml-1.5 text-[11px] text-g400">стартова база</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-g600">{num(c.size)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-g600">
                    {money(c.totalRevenue)}
                  </td>
                  {Array.from({ length: maxHorizon }, (_, k) => {
                    const v = c.activity[k];
                    if (v === undefined) {
                      return <td key={k} className="px-3 py-2.5 text-center text-g300">·</td>;
                    }
                    return (
                      <td key={k} className="px-1.5 py-1.5 text-center">
                        <span
                          className="inline-block min-w-11 rounded px-1.5 py-1 text-xs font-medium tabular-nums"
                          style={k === 0 ? undefined : cellStyle(v)}
                        >
                          {num(v, 0)}%
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      {churn.top.length === 0 ? (
        <Card>
          <EmptyState title="Відтоку немає" hint="Жоден клієнт із 2+ покупками не мовчить довше 60 днів." />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Кого повертати першими"
              hint="Оборот на місяць, поки клієнт купував. У кого вся історія коротша за місяць — це разова закупівля під обʼєкт, а не втрачений щомісячний дохід."
            />
          </div>
          <TableScroll minWidth={760}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Клієнт</th>
                  <th className="px-4 py-2.5">Стан</th>
                  <th className="px-4 py-2.5 text-right">Давав, грн/міс</th>
                  <th className="px-4 py-2.5 text-right">Всього купив</th>
                  <th className="px-4 py-2.5 text-right">Мовчить, дн.</th>
                  <th className="px-4 py-2.5">Торговий</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {churn.top.map((c) => (
                  <tr key={c.counterpartyId} className="transition-colors hover:bg-g50">
                    <td className="px-4 py-3 text-bk">{c.name}</td>
                    <td className="px-4 py-3">
                      <Badge status={c.state === "LOST" ? "bad" : "warn"}>
                        {c.state === "LOST" ? "втрачений" : "засинає"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                      {money(c.avgMonthly)}
                      {c.oneOff && (
                        <span
                          className="block text-[11px] font-normal text-g400"
                          title="Уся історія клієнта вклалася менш ніж у місяць — це разова закупівля, а не місячний ритм"
                        >
                          разова закупівля
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">
                      {money(c.totalRevenue)}
                      <span className="block text-[11px] text-g400">{num(c.docs)} док.</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{num(c.daysSinceLast)}</td>
                    <td className="px-4 py-3 text-g600">{c.repName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}
    </div>
  );
}
