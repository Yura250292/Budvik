"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { PeriodPicker, kyivToday, type Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { ProgressBar, StatCard, money, num } from "@/components/ui/Stat";
import { CardSkeleton, StatCardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { useApi } from "../../components/useApi";
import { ErrorBox } from "../../components/ErrorBox";
import { Badge } from "@/components/ui/Badge";
import { ColorDot } from "@/components/ui/Badge";
import { CATEGORICAL, NEUTRAL, STATUS, attainmentStatus } from "@/lib/analytics/colors";
import { BUCKET_LABELS, BUCKET_COLORS } from "@/lib/erp/receivables";
import type { ReceivableBucket } from "@prisma/client";

/**
 * Профіль торгового: продажі по фірмах, поїздки, паливо і план в одному
 * екрані. Саме тут видно зв'язок «оборот ↔ кілометраж ↔ витрати».
 */

const TimelineChart = dynamic(() => import("../../components/Charts").then((m) => m.TimelineChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full" />,
});
const PlanVsActualChart = dynamic(() => import("../../components/Charts").then((m) => m.PlanVsActualChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[320px] w-full" />,
});

type RepResponse = {
  period: { from: string; to: string; days: number };
  month: string;
  rep: { id: string; name: string; email: string; phone: string | null; telegramUsername: string | null };
  totals: { docs: number; amount: number; average: number };
  plan: { target: number; actual: number; attainment: number };
  byBrand: Array<{
    brandId: string | null;
    brandName: string;
    color: string | null;
    amount: number;
    qty: number;
    target: number;
    attainment: number;
  }>;
  trips: {
    count: number;
    totalKm: number;
    personalKm: number;
    workKm: number;
    checkpoints: number;
    daysWorked: number;
    kmPerCheckpoint: number;
  };
  fuel: {
    label: string | null;
    hasVehicle: boolean;
    fuelConsumption: number;
    fuelPricePerL: number;
    liters: number;
    cost: number;
    costPerDay: number;
    costPerRevenue: number;
  };
  collected: { amount: number; profit: number; ratio: number };
  receivables: {
    asOf: string;
    total: number;
    current: number;
    overdue: number;
    overdueRatio: number;
    buckets: Record<ReceivableBucket, number>;
    invoices: Array<{
      id: string;
      number: string;
      client: string;
      issuedAt: string;
      ageDays: number;
      debt: number;
      bucket: ReceivableBucket;
      daysOverdue: number;
    }>;
  };
  earnings: null | {
    schemeName: string;
    total: number;
    gross: number;
    penalties: number;
    lines: Array<{ ruleId: string; label: string; amount: number; explanation: string }>;
  };
  timeline: Array<{ day: string; docs: number; amount: number }>;
  documents: Array<{ id: string; number: string; date: string; amount: number; client: string }>;
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date(iso));
}

export function RepProfile({
  repId,
  initialPeriod,
}: {
  repId: string;
  initialPeriod: Period;
}) {
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const { data, loading, error, reload } = useApi<RepResponse>(
    `/api/admin/sales-analytics/rep/${repId}?from=${period.from}&to=${period.to}`
  );

  const backHref = `/admin/sales-analytics?from=${period.from}&to=${period.to}`;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-g200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={backHref}
              aria-label="Назад до списку торгових"
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-btn)] border border-g200 text-g600 transition-colors hover:border-g300 hover:text-bk"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold leading-tight text-bk sm:text-xl">
                {data?.rep.name ?? "Торговий"}
              </h1>
              <p className="truncate text-xs text-g400">
                {data?.rep.telegramUsername ? `@${data.rep.telegramUsername} · ` : ""}
                {data?.rep.phone ?? data?.rep.email ?? ""}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-4 px-4 pt-4 pb-10 sm:px-6">
        <PeriodPicker value={period} onChange={setPeriod} />

        {error && <ErrorBox message={error} onRetry={reload} />}

        {loading && !data && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <StatCardSkeleton key={i} />
              ))}
            </div>
            <CardSkeleton rows={6} />
          </>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatCard label="Оборот" value={money(data.totals.amount)} unit="грн" hint={`${data.totals.docs} док.`} accent={CATEGORICAL[0]} />
              <StatCard
                label="Зібрано коштів"
                value={money(data.collected.amount)}
                unit="грн"
                hint={data.collected.ratio > 0 ? `${num(data.collected.ratio)}% від обороту` : "оплат за період немає"}
                accent={CATEGORICAL[4]}
              />
              <StatCard label="Середній чек" value={money(data.totals.average)} unit="грн" accent={CATEGORICAL[2]} />
              <StatCard
                label="Робочі км"
                value={num(data.trips.workKm)}
                unit="км"
                hint={`${data.trips.count} поїзд. / ${data.trips.daysWorked} дн.`}
                accent={CATEGORICAL[1]}
              />
              <StatCard
                label="Паливо"
                value={money(data.fuel.cost)}
                unit="грн"
                hint={data.fuel.hasVehicle ? (data.fuel.label ?? "авто заведено") : "норма за замовчуванням"}
                accent={CATEGORICAL[3]}
              />
            </div>

            {/* --- План місяця --- */}
            <Card>
              <CardHeader
                title={`План на ${data.month}`}
                hint="Загальний план обороту за місяць. Плани задаються на вкладці «КПІ та плани»."
              />
              {data.plan.target > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-2xl font-semibold tabular-nums text-bk">{money(data.plan.actual)}</span>
                    <span className="text-sm text-g500">із {money(data.plan.target)} грн</span>
                    <span className="ml-auto">
                      <Badge status={attainmentStatus(data.plan.attainment)} dot>
                        {Math.round(data.plan.attainment)}%
                      </Badge>
                    </span>
                  </div>
                  <ProgressBar percent={data.plan.attainment} showValue={false} height={10} />
                  {data.plan.attainment < 100 && (
                    <p className="text-xs text-g500">
                      До плану залишилось {money(data.plan.target - data.plan.actual)} грн.
                    </p>
                  )}
                </div>
              ) : (
                <EmptyState
                  title="План на місяць не заданий"
                  hint="Задайте його на вкладці «КПІ та плани», щоб бачити відсоток виконання."
                />
              )}
            </Card>

            {/* --- Дебіторка і заробіток --- */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card padded={false}>
                <div className="p-4 sm:p-5">
                  <CardHeader
                    title="Дебіторка"
                    hint={`Непогашені рахунки станом на ${formatDate(data.receivables.asOf)} — залишок, а не оборот за період. Борг старший за 14 днів вважається протермінованим.`}
                  />

                  {data.receivables.total > 0 ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-2xl font-semibold tabular-nums text-bk">
                          {money(data.receivables.total)}
                        </span>
                        <span className="text-sm text-g500">грн</span>
                        <span className="ml-auto">
                          <Badge status={data.receivables.overdue > 0 ? "bad" : "good"} dot>
                            {data.receivables.overdue > 0
                              ? `прострочено ${money(data.receivables.overdue)} (${num(data.receivables.overdueRatio)}%)`
                              : "простроченої немає"}
                          </Badge>
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {(Object.keys(BUCKET_LABELS) as ReceivableBucket[])
                          .filter((b) => data.receivables.buckets[b] > 0)
                          .map((b) => (
                            <span
                              key={b}
                              className="inline-flex items-center gap-1.5 rounded-[var(--radius-badge)] border border-g200 px-2 py-1 text-xs"
                            >
                              <ColorDot color={BUCKET_COLORS[b]} size={8} />
                              <span className="text-g600">{BUCKET_LABELS[b]}</span>
                              <span className="font-semibold tabular-nums text-bk">
                                {money(data.receivables.buckets[b])}
                              </span>
                            </span>
                          ))}
                      </div>
                    </div>
                  ) : (
                    <EmptyState title="Дебіторки немає" hint="Усі виставлені рахунки оплачені." />
                  )}
                </div>

                {data.receivables.invoices.length > 0 && (
                  <div className="max-h-[320px] overflow-auto border-t border-g100">
                    <table className="w-full min-w-[480px] text-sm">
                      <thead className="sticky top-0">
                        <tr className="border-b border-g200 bg-g50 text-left text-xs font-medium text-g500">
                          <th className="px-4 py-2.5">Клієнт</th>
                          <th className="px-4 py-2.5">Рахунок від</th>
                          <th className="px-4 py-2.5 text-right">Борг</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-g100">
                        {data.receivables.invoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-g50">
                            <td className="px-4 py-2.5">
                              <span className="inline-flex items-center gap-2">
                                <ColorDot color={BUCKET_COLORS[inv.bucket]} size={8} />
                                <span className="text-bk">{inv.client}</span>
                              </span>
                              <span className="ml-4 block font-mono text-xs text-g400">{inv.number}</span>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-g600">
                              {formatDate(inv.issuedAt)}
                              <span className="block text-g400">{num(inv.ageDays)} дн. тому</span>
                              {inv.daysOverdue > 0 && (
                                <span className="block" style={{ color: BUCKET_COLORS[inv.bucket] }}>
                                  прострочено {num(inv.daysOverdue)} дн.
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-bk">
                              {money(inv.debt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card>
                <CardHeader
                  title="Заробіток"
                  hint={
                    data.earnings
                      ? `Схема: ${data.earnings.schemeName}. Рахується зі зібраних коштів, а не з обороту.`
                      : undefined
                  }
                />

                {data.earnings ? (
                  <div className="space-y-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-semibold tabular-nums text-bk">
                        {money(data.earnings.total)}
                      </span>
                      <span className="text-sm text-g500">грн</span>
                    </div>

                    {data.earnings.lines.length > 0 ? (
                      <dl className="divide-y divide-g100 text-sm">
                        {data.earnings.lines.map((line) => (
                          <div key={line.ruleId} className="flex items-baseline justify-between gap-3 py-2">
                            <dt className="min-w-0">
                              <span className="block text-g600">{line.label}</span>
                              <span className="block text-xs text-g500">{line.explanation}</span>
                            </dt>
                            <dd
                              className="shrink-0 font-medium tabular-nums"
                              style={{ color: line.amount < 0 ? STATUS.bad.fg : "var(--color-bk)" }}
                            >
                              {line.amount < 0 ? "−" : ""}
                              {money(Math.abs(line.amount))}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="text-xs text-g500">
                        Жодне правило схеми не спрацювало: за період немає ані зібраних коштів, ані виконаних планів.
                      </p>
                    )}

                    <dl className="border-t border-g200 pt-2 text-sm">
                      <div className="flex items-baseline justify-between gap-3 py-1">
                        <dt className="text-g600">Нараховано</dt>
                        <dd className="font-medium tabular-nums text-bk">{money(data.earnings.gross)}</dd>
                      </div>
                      {data.earnings.penalties > 0 && (
                        <div className="flex items-baseline justify-between gap-3 py-1">
                          <dt className="text-g600">Утримання</dt>
                          <dd className="font-medium tabular-nums" style={{ color: STATUS.bad.fg }}>
                            −{money(data.earnings.penalties)}
                          </dd>
                        </div>
                      )}
                      <div className="flex items-baseline justify-between gap-3 py-1">
                        <dt className="font-semibold text-bk">До виплати</dt>
                        <dd className="font-semibold tabular-nums text-bk">{money(data.earnings.total)}</dd>
                      </div>
                    </dl>
                  </div>
                ) : (
                  <EmptyState
                    title="Схему мотивації не призначено"
                    hint="Призначте її на вкладці «Мотивація» — тоді тут з'явиться розрахунок заробітку."
                  />
                )}
              </Card>
            </div>

            <Card>
              <CardHeader title="Динаміка обороту" />
              {data.timeline.length > 0 ? (
                <TimelineChart data={data.timeline} />
              ) : (
                <EmptyState title="Немає продажів за період" />
              )}
            </Card>

            {/* --- Фірми (бренди) --- */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card padded={false}>
                <div className="p-4 sm:p-5">
                  <CardHeader
                    title="Продажі по фірмах"
                    hint="План по бренду за місяць проти факту за обраний період"
                  />
                </div>
                {data.byBrand.length === 0 ? (
                  <div className="pb-4">
                    <EmptyState title="Немає продажів по брендах" />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-sm">
                      <thead>
                        <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                          <th className="px-4 py-2.5">Фірма</th>
                          <th className="px-4 py-2.5 text-right">Сума</th>
                          <th className="px-4 py-2.5 text-right">Кількість</th>
                          <th className="w-32 px-4 py-2.5">План</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-g100">
                        {data.byBrand.map((b) => (
                          <tr key={b.brandId ?? "none"} className="hover:bg-g50">
                            <td className="px-4 py-2.5">
                              <span className="inline-flex items-center gap-2">
                                <ColorDot color={b.color ?? NEUTRAL} />
                                <span className="text-bk">{b.brandName}</span>
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-bk">
                              {money(b.amount)}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-g600">{num(b.qty)}</td>
                            <td className="px-4 py-2.5">
                              {b.target > 0 ? (
                                <ProgressBar percent={b.attainment} height={5} />
                              ) : (
                                <span className="text-xs text-g400">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card>
                <CardHeader title="План проти факту по фірмах" />
                {data.byBrand.some((b) => b.target > 0) ? (
                  <PlanVsActualChart
                    data={data.byBrand
                      .filter((b) => b.target > 0 || b.amount > 0)
                      .slice(0, 10)
                      .map((b) => ({ name: b.brandName, target: b.target, actual: b.amount }))}
                    height={Math.max(200, Math.min(10, data.byBrand.length) * 32 + 40)}
                  />
                ) : (
                  <EmptyState
                    title="Плани по фірмах не задані"
                    hint="Задайте їх у «КПІ та плани» — тоді тут з'явиться порівняння."
                  />
                )}
              </Card>
            </div>

            {/* --- Логістика --- */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Поїздки та логістика" hint="Дані з Telegram-бота" />
                <dl className="divide-y divide-g100 text-sm">
                  {[
                    ["Поїздок", num(data.trips.count)],
                    ["Робочих днів", num(data.trips.daysWorked)],
                    ["Робочі км", `${num(data.trips.workKm)} км`],
                    ["Особисті км", data.trips.personalKm > 0 ? `${num(data.trips.personalKm)} км` : "—"],
                    ["Візитів", num(data.trips.checkpoints)],
                    ["Км на точку", data.trips.kmPerCheckpoint > 0 ? num(data.trips.kmPerCheckpoint, 1) : "—"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3 py-2">
                      <dt className="text-g600">{label}</dt>
                      <dd className="font-medium tabular-nums text-bk">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>

              <Card>
                <CardHeader
                  title="Пальне"
                  hint={`${num(data.fuel.fuelConsumption, 1)} л/100км × ${num(data.fuel.fuelPricePerL, 2)} грн/л${
                    data.fuel.hasVehicle ? "" : " (за замовчуванням — авто не заведено)"
                  }`}
                />
                <dl className="divide-y divide-g100 text-sm">
                  {[
                    ["Витрачено", `${num(data.fuel.liters, 1)} л`],
                    ["Вартість", `${money(data.fuel.cost)} грн`],
                    ["За день", `${money(data.fuel.costPerDay)} грн`],
                    [
                      "Частка в обороті",
                      data.fuel.costPerRevenue > 0 ? `${(data.fuel.costPerRevenue * 100).toFixed(2)} %` : "—",
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3 py-2">
                      <dt className="text-g600">{label}</dt>
                      <dd className="font-medium tabular-nums text-bk">{value}</dd>
                    </div>
                  ))}
                </dl>
                {!data.fuel.hasVehicle && (
                  <p className="mt-3 text-xs text-g500">
                    Заведіть авто на вкладці «Паливо», щоб розрахунок був точним.
                  </p>
                )}
              </Card>
            </div>

            {/* --- Документи --- */}
            <Card padded={false}>
              <div className="p-4 sm:p-5">
                <CardHeader title="Останні документи" hint="Проведені документи з 1С, до 50 штук" />
              </div>
              {data.documents.length === 0 ? (
                <div className="pb-4">
                  <EmptyState title="Немає документів за період" />
                </div>
              ) : (
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="sticky top-0">
                      <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                        <th className="px-4 py-2.5">Номер</th>
                        <th className="px-4 py-2.5">Дата</th>
                        <th className="px-4 py-2.5">Клієнт</th>
                        <th className="px-4 py-2.5 text-right">Сума</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-g100">
                      {data.documents.map((d) => (
                        <tr key={d.id} className="hover:bg-g50">
                          <td className="px-4 py-2.5 font-mono text-xs text-g600">{d.number}</td>
                          <td className="px-4 py-2.5 text-g600">{formatDate(d.date)}</td>
                          <td className="px-4 py-2.5 text-bk">{d.client}</td>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-bk">
                            {money(d.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

export function defaultPeriod(): Period {
  const today = kyivToday();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}
