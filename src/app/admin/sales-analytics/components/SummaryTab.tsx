"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ReceivableBucket } from "@prisma/client";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { money, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { attainmentStatus, STATUS, categoricalColor } from "@/lib/analytics/colors";
import { BUCKET_LABELS, BUCKET_COLORS } from "@/lib/erp/receivables";
import { useApi } from "./useApi";
import { ErrorBox } from "./ErrorBox";

/**
 * Зведена по торгових: усі залежності в одному рядку.
 *
 * Сенс вкладки — відповісти на питання цілком, не гортаючи інші: скільки
 * продав, скільки з того реально зібрав, скільки за ним висить боргу,
 * скільки з'їв бензин і що з цього вийшло заробітку.
 *
 * Дані приходять одним запитом. Вкладка «Торгові» зшиває три ендпоінти на
 * клієнті, і кожен новий показник там — це ще один fetch і ще одне місце,
 * де числа можуть розійтися.
 */

type SummaryRow = {
  repId: string;
  repName: string;
  revenue: number;
  docs: number;
  clients: number;
  avgCheck: number;
  profit: number;
  plan: { target: number; actual: number; attainment: number };
  fuel: { cost: number; workKm: number; hasVehicle: boolean };
  collected: number;
  collectedProfit: number;
  receivables: {
    total: number;
    overdue: number;
    overdueRatio: number;
    buckets: Record<ReceivableBucket, number>;
    unknown: number;
  };
  earnings: null | { total: number; gross: number; penalties: number; schemeName: string };
  net: number;
};

type SummaryResponse = {
  period: { from: string; to: string; days: number };
  month: string;
  receivablesAsOf: string;
  rows: SummaryRow[];
  totals: {
    revenue: number;
    docs: number;
    clients: number;
    avgCheck: number;
    profit: number;
    plan: { target: number; actual: number; attainment: number };
    fuelCost: number;
    collected: number;
    receivableTotal: number;
    receivableOverdue: number;
    receivableUnknown: number;
    earnings: number;
    earningsCovered: number;
    net: number;
  };
  unattributed: { count: number; total: number };
};

type ReceivablesResponse = {
  syncedAt: string | null;
  aging: {
    total: number;
    current: number;
    overdue: number;
    overdueRatio: number;
    buckets: Record<ReceivableBucket, number>;
    unknown: number;
  };
  clients: Array<{
    counterpartyId: string;
    name: string;
    code: string | null;
    debt: number;
    overdue: number | null;
    current: number | null;
    buckets: Record<ReceivableBucket, number> | null;
    lastDocAt: string | null;
  }>;
};

const COLS = 11;

const dateFmt = new Intl.DateTimeFormat("uk-UA", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "Europe/Kyiv",
});

/** Розгорнута дебіторка одного торгового: клієнти, рахунки, старіння. */
function ReceivablesPanel({ repId }: { repId: string }) {
  const { data, loading, error, reload } = useApi<ReceivablesResponse>(
    `/api/admin/sales-analytics/receivables?repId=${repId}`
  );

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <div className="px-4 py-3 text-xs text-g500">Завантаження…</div>;
  if (!data || data.clients.length === 0) {
    return <div className="px-4 py-3 text-xs text-g500">Боргів немає.</div>;
  }

  const buckets = (Object.keys(BUCKET_LABELS) as ReceivableBucket[]).filter(
    (b) => data.aging.buckets[b] > 0
  );

  return (
    <div className="space-y-3 border-l-2 border-g200 bg-g50 px-4 py-3">
      {buckets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {buckets.map((b) => (
            <span
              key={b}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-badge)] border border-g200 bg-white px-2 py-1 text-xs"
            >
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: BUCKET_COLORS[b] }}
              />
              <span className="text-g600">{BUCKET_LABELS[b]}</span>
              <span className="font-semibold tabular-nums text-bk">{money(data.aging.buckets[b])}</span>
            </span>
          ))}
        </div>
      )}

      {data.aging.unknown > 0 && (
        <p className="text-xs text-g500">
          Для {money(data.aging.unknown)} грн 1С ще не передала розбивку за строками — цей борг не
          віднесено ні до робочого, ні до простроченого.
        </p>
      )}

      <div className="max-h-[320px] overflow-auto rounded-[var(--radius-card)] border border-g200 bg-white">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="sticky top-0 z-10 bg-g50">
            <tr className="border-b border-g200 text-left font-medium text-g500">
              <th className="px-3 py-2">Клієнт</th>
              <th className="px-3 py-2">Остання відвантажка</th>
              <th className="px-3 py-2 text-right">Робоча</th>
              <th className="px-3 py-2 text-right">Прострочено</th>
              <th className="px-3 py-2 text-right">Борг, грн</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-g100">
            {data.clients.map((client) => (
              <tr key={client.counterpartyId}>
                <td className="px-3 py-2">
                  <span className="font-medium text-bk">{client.name}</span>
                  {client.code && <span className="ml-2 font-mono text-g400">{client.code}</span>}
                </td>
                <td className="px-3 py-2 text-g600">
                  {client.lastDocAt ? dateFmt.format(new Date(client.lastDocAt)) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-g600">
                  {client.current === null ? <span className="text-g400">?</span> : money(client.current)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {client.overdue === null ? (
                    <span className="text-g400" title="1С не передала розбивку за строками">
                      ?
                    </span>
                  ) : client.overdue > 0 ? (
                    <span className="font-semibold" style={{ color: STATUS.bad.fg }}>
                      {money(client.overdue)}
                    </span>
                  ) : (
                    <span className="text-g400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-bk">
                  {money(client.debt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SummaryTab({ period }: { period: Period }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, loading, error, reload } = useApi<SummaryResponse>(
    `/api/admin/sales-analytics/summary?from=${period.from}&to=${period.to}`
  );

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <TableSkeleton rows={6} cols={COLS} />;

  if (!data || data.rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Немає торгових"
          hint="Зведена будується по користувачах із роллю «Торговий». Заведіть їх у розділі «Торгові представники»."
        />
      </Card>
    );
  }

  const { rows, totals } = data;
  const asOf = dateFmt.format(new Date(data.receivablesAsOf));

  return (
    <div className="space-y-3">
      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Зведена по торгових"
            hint={`Оборот, паливо і зібрані кошти — за обраний період. Виконання плану — за місяць ${data.month}. Дебіторка — сальдо з 1С станом на ${asOf}, не залежить від періоду. Клік по рядку відкриває профіль.`}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                <th className="sticky left-0 z-10 bg-g50 px-4 py-2.5">Торговий</th>
                <th className="px-4 py-2.5 text-right">Оборот, грн</th>
                <th className="px-4 py-2.5 text-right">Док.</th>
                <th className="px-4 py-2.5 text-right">Клієнти</th>
                <th className="px-4 py-2.5 text-right">Сер. чек</th>
                <th className="px-4 py-2.5 text-right">План</th>
                <th className="px-4 py-2.5 text-right">Паливо, грн</th>
                <th className="px-4 py-2.5 text-right">Зібрано, грн</th>
                <th className="px-4 py-2.5 text-right">Дебіторка, грн</th>
                <th className="px-4 py-2.5 text-right">Заробіток, грн</th>
                <th className="px-4 py-2.5 text-right">Чистий результат</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-g100">
              {rows.map((r, i) => (
                <tr
                  key={r.repId}
                  onClick={() =>
                    router.push(`/admin/sales-analytics/${r.repId}?from=${period.from}&to=${period.to}`)
                  }
                  className="cursor-pointer transition-colors hover:bg-g50"
                >
                  <td className="sticky left-0 z-10 bg-white px-4 py-3">
                    <span
                      aria-hidden
                      className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full align-middle"
                      style={{ backgroundColor: categoricalColor(i) }}
                    />
                    <span className="font-medium text-bk">{r.repName}</span>
                  </td>

                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                    {money(r.revenue)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-g600">{num(r.docs)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-g600">{num(r.clients)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-g600">{money(r.avgCheck)}</td>

                  <td className="px-4 py-3 text-right">
                    {r.plan.target > 0 ? (
                      <Badge status={attainmentStatus(r.plan.attainment, true)} dot>
                        {num(r.plan.attainment)}%
                      </Badge>
                    ) : (
                      <span className="text-xs text-g400">не задано</span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right tabular-nums text-g600">
                    {money(r.fuel.cost)}
                    {!r.fuel.hasVehicle && r.fuel.workKm > 0 && (
                      <span className="ml-1 text-xs text-g400" title="Авто не заведено — норма і ціна типові">
                        ~
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right tabular-nums text-g600">{money(r.collected)}</td>

                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpanded(expanded === r.repId ? null : r.repId);
                      }}
                      disabled={r.receivables.total <= 0}
                      aria-expanded={expanded === r.repId}
                      className="inline-flex cursor-pointer flex-col items-end gap-0.5 rounded px-1 py-0.5 transition-colors hover:bg-g100 disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="font-semibold tabular-nums text-bk">
                        {money(r.receivables.total)}
                        {r.receivables.total > 0 && (
                          <span aria-hidden className="ml-1 text-xs text-g400">
                            {expanded === r.repId ? "▴" : "▾"}
                          </span>
                        )}
                      </span>
                      {r.receivables.overdue > 0 && (
                        <span className="text-[11px] tabular-nums" style={{ color: STATUS.bad.fg }}>
                          прострочено {money(r.receivables.overdue)} ({num(r.receivables.overdueRatio)}%)
                        </span>
                      )}
                    </button>
                  </td>

                  <td className="px-4 py-3 text-right">
                    {r.earnings ? (
                      <span
                        className="font-semibold tabular-nums text-bk"
                        title={
                          r.earnings.penalties > 0
                            ? `Нараховано ${money(r.earnings.gross)}, утримано ${money(r.earnings.penalties)}`
                            : `Схема: ${r.earnings.schemeName}`
                        }
                      >
                        {money(r.earnings.total)}
                      </span>
                    ) : (
                      <span
                        className="text-g400"
                        title="Схему мотивації не призначено — зробіть це на вкладці «Мотивація»"
                      >
                        —
                      </span>
                    )}
                  </td>

                  <td
                    className="px-4 py-3 text-right font-semibold tabular-nums"
                    style={{ color: r.net >= 0 ? STATUS.good.fg : STATUS.bad.fg }}
                  >
                    {money(r.net)}
                  </td>
                </tr>
              ))}

              {/* Розгорнута дебіторка — окремим рядком, як у «Поїздках» */}
              {expanded && (
                <tr>
                  <td colSpan={COLS} className="p-0">
                    <ReceivablesPanel repId={expanded} />
                  </td>
                </tr>
              )}
            </tbody>

            <tfoot>
              <tr className="border-t border-g200 bg-g50 text-sm font-semibold">
                <td className="sticky left-0 z-10 bg-g50 px-4 py-3 text-bk">Разом</td>
                <td className="px-4 py-3 text-right tabular-nums text-bk">{money(totals.revenue)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-g600">{num(totals.docs)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-g600">{num(totals.clients)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-g600">{money(totals.avgCheck)}</td>
                <td className="px-4 py-3 text-right">
                  {totals.plan.target > 0 ? (
                    <Badge status={attainmentStatus(totals.plan.attainment, true)} dot>
                      {num(totals.plan.attainment)}%
                    </Badge>
                  ) : (
                    <span className="text-xs font-normal text-g400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-g600">{money(totals.fuelCost)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-g600">{money(totals.collected)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-bk">
                  {money(totals.receivableTotal)}
                  {totals.receivableOverdue > 0 && (
                    <span className="block text-[11px] font-normal tabular-nums" style={{ color: STATUS.bad.fg }}>
                      прострочено {money(totals.receivableOverdue)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-bk">
                  {money(totals.earnings)}
                  {totals.earningsCovered < rows.length && (
                    <span className="block text-[11px] font-normal text-g400">
                      по {totals.earningsCovered} з {rows.length}
                    </span>
                  )}
                </td>
                <td
                  className="px-4 py-3 text-right tabular-nums"
                  style={{ color: totals.net >= 0 ? STATUS.good.fg : STATUS.bad.fg }}
                >
                  {money(totals.net)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {data.unattributed.count > 0 && (
          <p className="border-t border-g100 px-4 py-3 text-xs text-g500">
            Дебіторка без торгового: <span className="font-medium text-g600">{money(data.unattributed.total)}</span>{" "}
            ({num(data.unattributed.count)} рах.) — рахунки без документа продажу і без закріпленого клієнта. У рядки
            таблиці не входять.
          </p>
        )}
      </Card>

      <p className="px-1 text-xs text-g500">
        «Чистий результат» — прибуток по продажах за період мінус пальне. «Заробіток» рахується зі зібраних коштів за
        схемою мотивації, а не з обороту: продаж без оплати не приносить торговому нічого.
      </p>
    </div>
  );
}
