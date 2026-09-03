"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ReceivableBucket } from "@prisma/client";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { money } from "@/components/ui/Stat";
import { TableScroll } from "@/components/ui/TableScroll";
import { PeriodPicker, type Period, PRESETS } from "@/components/ui/PeriodPicker";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { useProfile } from "@/lib/useProfile";
import {
  BUCKET_LABELS,
  BUCKET_COLORS,
  STAGE_LABELS,
  STAGE_COLORS,
  type WorkingStage,
} from "@/lib/erp/receivables";

/**
 * Бухгалтерські звіти.
 *
 * Сторінка навмисно не показує P&L. Попередня версія показувала — і три з
 * чотирьох чисел там були вигадані: 1С не передає ані собівартості в
 * рядках реалізації, ані надходжень товару (див. src/lib/erp/accounting.ts).
 * Маржа виходила 0,1% і виглядала правдоподібно, а це найгірший різновид
 * помилки: за таким числом приймають рішення.
 *
 * Замість цього — два грошові потоки поруч: відвантажено (метод
 * нарахування) і зібрано (касовий метод). Різниця між ними і є те, що
 * бухгалтерія має бачити щодня. А чого в даних немає — сказано прямо
 * блоком «Чого бракує», а не показано нулями.
 */

type MonthRow = {
  month: string;
  shipped: number;
  shippedCount: number;
  collected: number;
  collectedCount: number;
};

type Debtor = {
  counterpartyId: string;
  name: string;
  debt: number;
  overdue: number;
  oldestDays: number | null;
  lastDocAt: string | null;
};

type Report = {
  period: { from: string; to: string; days: number };
  shipped: { total: number; count: number; clients: number };
  /** Сума повернень за період, додатна. */
  returned: { total: number; count: number; clients: number };
  /** shipped − returned: число, зіставне з оборотом в аналітиці торгових. */
  shippedNet: number;
  /** Проведені надходження товару за період — те, що завезли на склад. */
  purchased: { total: number; count: number; suppliers: number };
  collected: { total: number; count: number; clients: number };
  gap: number;
  months: MonthRow[];
  receivables: {
    total: number;
    overdue: number;
    overdueRatio: number;
    buckets: Record<ReceivableBucket, number>;
    stages: Record<WorkingStage, number>;
    unknown: number;
    debtors: Debtor[];
  };
  advances: { total: number; count: number; clients: Array<{ id: string; name: string; amount: number }> };
  gaps: string[];
};

const MONTH_NAMES = [
  "січень", "лютий", "березень", "квітень", "травень", "червень",
  "липень", "серпень", "вересень", "жовтень", "листопад", "грудень",
];

function monthLabel(m: string): string {
  const [y, mm] = m.split("-").map(Number);
  return `${MONTH_NAMES[mm - 1] ?? m} ${y}`;
}

export default function AccountingReportsPage() {
  const profile = useProfile();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // «Цей місяць» за замовчуванням: бухгалтерію цікавить поточний період
  // закриття, а не довільні 30 днів упоперек двох місяців.
  const [period, setPeriod] = useState<Period>(() => PRESETS.find((p) => p.key === "curmonth")!.make());

  const role = profile?.role;
  const allowed = role === "ADMIN" || role === "MANAGER";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/erp/reports?from=${period.from}&to=${period.to}`);
      if (!res.ok) throw new Error(`Помилка ${res.status}`);
      setReport(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити звіт");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    if (allowed) load();
  }, [allowed, load]);

  const exportCSV = () => {
    if (!report) return;
    const rows: Array<Array<string | number>> = [
      ["Бухгалтерський звіт Budvik"],
      ["Період", `${report.period.from} — ${report.period.to}`],
      [""],
      ["Показник", "Сума (грн)", "Документів"],
      ["Відвантажено (реалізації, брутто)", Math.round(report.shipped.total), report.shipped.count],
      ["Повернення від покупців", -Math.round(report.returned.total), report.returned.count],
      ["Відвантажено нетто", Math.round(report.shippedNet), ""],
      ["Завезено на склад (прихід)", Math.round(report.purchased.total), report.purchased.count],
      ["Зібрано грошей (каса)", Math.round(report.collected.total), report.collected.count],
      ["Розрив (нетто − зібрано)", Math.round(report.gap), ""],
      [""],
      ["Дебіторська заборгованість (на зараз)", Math.round(report.receivables.total), ""],
      ["у т.ч. робоча", Math.round(report.receivables.total - report.receivables.overdue), ""],
      ["у т.ч. прострочена", Math.round(report.receivables.overdue), ""],
      ["Аванси покупців", Math.round(report.advances.total), report.advances.count],
      [""],
      ["Помісячно"],
      ["Місяць", "Відвантажено", "Зібрано", "Розрив"],
      ...report.months.map((m) => [
        m.month,
        Math.round(m.shipped),
        Math.round(m.collected),
        Math.round(m.shipped - m.collected),
      ]),
      [""],
      ["Боржники"],
      ["Контрагент", "Борг", "Прострочено", "Днів"],
      ...report.receivables.debtors.map((d) => [
        `"${d.name.replace(/"/g, '""')}"`,
        Math.round(d.debt),
        Math.round(d.overdue),
        d.oldestDays ?? "",
      ]),
      [""],
      ["Чого бракує в даних"],
      ...report.gaps.map((g) => [`"${g.replace(/"/g, '""')}"`]),
    ];

    const csv = rows.map((r) => r.join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `buh_${report.period.from}_${report.period.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // profile === null означає «ще вантажиться»: useProfile віддає профіль
  // напряму, без окремого прапорця. Показати «доступ заборонено» до його
  // приходу означало б блимати відмовою в законного адміна.
  if (!profile) {
    return <div className="px-4 py-16 text-center text-sm text-g500">Завантаження…</div>;
  }

  if (!allowed) {
    return (
      <div className="px-4 py-16 text-center">
        <h1 className="text-xl font-semibold text-bk">Доступ заборонено</h1>
      </div>
    );
  }

  const maxFlow = report
    ? Math.max(1, ...report.months.map((m) => Math.max(m.shipped, m.collected)))
    : 1;

  const buckets = report
    ? (Object.keys(BUCKET_LABELS) as ReceivableBucket[]).filter((b) => report.receivables.buckets[b] > 0)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-bk">Бухгалтерські звіти</h1>
          <p className="mt-0.5 text-xs text-g500">Рух коштів, дебіторка та аванси за даними 1С</p>
        </div>
        <button
          type="button"
          onClick={exportCSV}
          disabled={!report}
          className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-xs font-medium text-g600 transition-colors hover:border-g300 hover:text-bk disabled:cursor-not-allowed disabled:opacity-50"
        >
          Експорт CSV
        </button>
      </div>

      <PeriodPicker value={period} onChange={setPeriod} />

      {error && <ErrorBox message={error} onRetry={load} />}

      {loading && !report ? (
        <div className="px-4 py-12 text-center text-sm text-g500">Завантаження…</div>
      ) : !report ? null : (
        <>
          {/* Два методи обліку поруч. Саме зіставлення, а не окремі картки:
              питання бухгалтерії — не «скільки продали», а «скільки з
              проданого дійшло до каси». */}
          <Card>
            <CardHeader
              title="Рух коштів за період"
              hint={`${report.period.from} — ${report.period.to}`}
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs font-medium text-g500">Відвантажено</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-bk">
                  {money(report.shipped.total)}
                </p>
                <p className="mt-1 text-xs text-g500">
                  {report.shipped.count} реалізацій · {report.shipped.clients} клієнтів
                </p>
              </div>
              {/* Повернення окремою статтею: відвантажено вище — брутто, і без
                  цього рядка звіт мовчки розходився б з оборотом торгових,
                  який рахується нетто. */}
              <div>
                <p className="text-xs font-medium text-g500">Повернення</p>
                <p
                  className="mt-1 text-2xl font-semibold tabular-nums tracking-tight"
                  style={{ color: report.returned.total > 0 ? BUCKET_COLORS.OVERDUE_60 : undefined }}
                >
                  {report.returned.total > 0 ? "−" : ""}
                  {money(report.returned.total)}
                </p>
                <p className="mt-1 text-xs text-g500">
                  {report.returned.count} документів · нетто {money(report.shippedNet)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-g500">Зібрано грошей</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight" style={{ color: STAGE_COLORS.AWAITING_PAYMENT }}>
                  {money(report.collected.total)}
                </p>
                <p className="mt-1 text-xs text-g500">
                  {report.collected.count} оплат · {report.collected.clients} клієнтів
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-g500">Розрив (нетто − зібрано)</p>
                <p
                  className="mt-1 text-2xl font-semibold tabular-nums tracking-tight"
                  style={{ color: report.gap > 0 ? BUCKET_COLORS.OVERDUE_60 : STAGE_COLORS.AWAITING_PAYMENT }}
                >
                  {report.gap > 0 ? "+" : ""}
                  {money(report.gap)}
                </p>
                <p className="mt-1 text-xs text-g500">
                  {report.gap > 0 ? "борг за період виріс" : "збирали більше, ніж відвантажували"}
                </p>
              </div>
            </div>

            {/* Закупівлі окремим рядком, а не п'ятою карткою вгорі: це інший
                бік балансу — скільки завезли проти того, скільки продали.
                Раніше тут стояв нуль, бо надходження з 1С не вивантажувались. */}
            <div className="mt-4 border-t border-g100 pt-4">
              <p className="text-xs font-medium text-g500">Завезено на склад (прихід)</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-bk">
                {money(report.purchased.total)}
              </p>
              <p className="mt-1 text-xs text-g500">
                {report.purchased.count} накладних · {report.purchased.suppliers} постачальників ·
                за цінами закупівлі, а не собівартістю проданого
              </p>
            </div>
          </Card>

          {/* Помісячна динаміка — за весь час, не за обраний період: тренд
              видно лише на довгому ряді, а період фільтрує картки вище. */}
          <Card>
            <CardHeader title="Помісячно" hint="Відвантаження та надходження грошей за всю історію обміну" />
            {report.months.length === 0 ? (
              <EmptyState title="Даних ще немає" />
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: "#2a78d6" }} />
                    <span className="text-g600">Відвантажено</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: STAGE_COLORS.AWAITING_PAYMENT }} />
                    <span className="text-g600">Зібрано</span>
                  </span>
                </div>
                <div className="space-y-2.5">
                  {report.months.map((m) => (
                    <div key={m.month} className="grid grid-cols-[7rem_1fr] items-center gap-3">
                      <span className="truncate text-xs text-g600">{monthLabel(m.month)}</span>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-g100">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${(m.shipped / maxFlow) * 100}%`, backgroundColor: "#2a78d6" }}
                            />
                          </div>
                          <span className="w-24 shrink-0 text-right text-xs font-medium tabular-nums text-bk">
                            {money(m.shipped)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-g100">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(m.collected / maxFlow) * 100}%`,
                                backgroundColor: STAGE_COLORS.AWAITING_PAYMENT,
                              }}
                            />
                          </div>
                          <span className="w-24 shrink-0 text-right text-xs font-medium tabular-nums text-g600">
                            {money(m.collected)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Дебіторка — залишок на «зараз», а не за період: борг не
              «виникає в періоді», він просто є. */}
          <Card>
            <CardHeader
              title="Дебіторська заборгованість"
              hint="Сальдо взаєморозрахунків 1С станом на зараз. Строки — за датами наших відвантажень"
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium text-g500">Усього</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-bk">
                  {money(report.receivables.total)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-g500">Робоча</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight" style={{ color: STAGE_COLORS.AWAITING_PAYMENT }}>
                  {money(report.receivables.total - report.receivables.overdue)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-g500">Прострочена</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight" style={{ color: BUCKET_COLORS.OVERDUE_90_PLUS }}>
                  {money(report.receivables.overdue)}
                </p>
                <p className="mt-1 text-xs text-g500">{Math.round(report.receivables.overdueRatio)}% від боргу</p>
              </div>
            </div>

            {buckets.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {buckets.map((b) => (
                  <span
                    key={b}
                    className="inline-flex items-center gap-1.5 rounded-[var(--radius-badge)] border border-g200 bg-white px-2 py-1 text-xs"
                  >
                    <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: BUCKET_COLORS[b] }} />
                    <span className="text-g600">{BUCKET_LABELS[b]}</span>
                    <span className="font-semibold tabular-nums text-bk">{money(report.receivables.buckets[b])}</span>
                  </span>
                ))}
              </div>
            )}

            {(report.receivables.stages.DELIVERY > 0 || report.receivables.stages.AWAITING_PAYMENT > 0) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {(Object.keys(STAGE_LABELS) as WorkingStage[])
                  .filter((s) => report.receivables.stages[s] > 0)
                  .map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1.5 rounded-[var(--radius-badge)] border border-g200 bg-white px-2 py-1 text-xs"
                    >
                      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: STAGE_COLORS[s] }} />
                      <span className="text-g600">{STAGE_LABELS[s]}</span>
                      <span className="font-semibold tabular-nums text-bk">{money(report.receivables.stages[s])}</span>
                    </span>
                  ))}
              </div>
            )}

            {report.receivables.unknown > 0.01 && (
              <p className="mt-3 text-xs text-g500">
                {money(report.receivables.unknown)} боргу не вдалося зіставити з відвантаженнями — він старший за
                нашу історію документів і врахований як прострочений понад 90 днів.
              </p>
            )}

            {report.receivables.debtors.length > 0 && (
              <div className="mt-4">
                <TableScroll stickyHeader minWidth={520}>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-g200">
                        <th className="py-2 text-left text-xs font-medium text-g500">Контрагент</th>
                        <th className="py-2 text-right text-xs font-medium text-g500">Борг</th>
                        <th className="py-2 text-right text-xs font-medium text-g500">Прострочено</th>
                        <th className="py-2 text-right text-xs font-medium text-g500">Днів</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.receivables.debtors.map((d) => (
                        <tr key={d.counterpartyId} className="border-b border-g100">
                          <td className="py-2 text-sm">
                            <Link
                              href={`/admin/erp/counterparties/${d.counterpartyId}`}
                              className="font-medium text-bk hover:underline"
                            >
                              {d.name}
                            </Link>
                          </td>
                          <td className="py-2 text-right text-sm font-semibold tabular-nums text-bk">
                            {money(d.debt)}
                          </td>
                          <td
                            className="py-2 text-right text-sm tabular-nums"
                            style={{ color: d.overdue > 0 ? BUCKET_COLORS.OVERDUE_90_PLUS : undefined }}
                          >
                            {d.overdue > 0 ? money(d.overdue) : "—"}
                          </td>
                          <td className="py-2 text-right text-sm tabular-nums text-g600">
                            {d.oldestDays ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </div>
            )}
          </Card>

          {/* Аванси окремою статтею, а не мінусом до дебіторки: для
              бухгалтерії це зобов'язання перед клієнтом, інша сторона
              балансу. Згорнути їх із боргом означало б сховати і те, і те. */}
          {report.advances.count > 0 && (
            <Card>
              <CardHeader
                title="Аванси покупців"
                hint="Від'ємні сальдо: клієнт заплатив наперед або переплатив. Це наше зобов'язання, не борг клієнта"
              />
              <p className="text-2xl font-semibold tabular-nums tracking-tight text-bk">
                {money(report.advances.total)}
              </p>
              <p className="mt-1 text-xs text-g500">у {report.advances.count} клієнтів</p>

              <div className="mt-4">
                <TableScroll stickyHeader minWidth={360}>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-g200">
                        <th className="py-2 text-left text-xs font-medium text-g500">Контрагент</th>
                        <th className="py-2 text-right text-xs font-medium text-g500">Аванс</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.advances.clients.map((c) => (
                        <tr key={c.id} className="border-b border-g100">
                          <td className="py-2 text-sm">
                            <Link
                              href={`/admin/erp/counterparties/${c.id}`}
                              className="font-medium text-bk hover:underline"
                            >
                              {c.name}
                            </Link>
                          </td>
                          <td className="py-2 text-right text-sm font-semibold tabular-nums text-bk">
                            {money(c.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </div>
            </Card>
          )}

          {/* Явний перелік того, чого 1С не віддає. Без нього порожні
              показники читалися б як справжні нулі — саме на цьому
              трималася попередня версія звіту. */}
          <Card>
            <CardHeader title="Чого бракує в даних" hint="Ці показники не можна порахувати, доки 1С їх не віддає" />
            <ul className="space-y-2">
              {report.gaps.map((g) => (
                <li key={g} className="flex gap-2 text-xs text-g600">
                  <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-g300" />
                  <span>{g}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
