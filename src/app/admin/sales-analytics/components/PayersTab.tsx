"use client";

/**
 * Платники: кому можна відвантажувати в борг.
 *
 * Порядок екрана — порядок рішень: скільки боргу і в чиїх руках (картки),
 * потім список від найгірших. Вердикти й пороги рахує сервер
 * (lib/analytics/discipline.ts) — тут лише показ і фільтр, щоб числа
 * неможливо було «підкрутити» на фронті.
 */

import { useMemo, useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, money, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { Badge } from "@/components/ui/Badge";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";

type Verdict = "RELIABLE" | "MODERATE" | "RISKY" | "CRITICAL";

type DisciplineResponse = {
  velocityDays: number;
  paymentsSince: string | null;
  totals: {
    clients: number;
    debt: number;
    overdue: number;
    byVerdict: Record<Verdict, { clients: number; debt: number }>;
  };
  rows: Array<{
    counterpartyId: string;
    name: string;
    repName: string | null;
    shipped: number;
    perMonth: number;
    debt: number;
    overdue: number;
    overdueShare: number;
    debtDays: number | null;
    paid: number;
    lastDocAt: string | null;
    verdict: Verdict;
    suggestedLimit: number;
  }>;
};

const VERDICTS: Array<{ key: Verdict; label: string; tone: "good" | "warn" | "bad" | "neutral"; desc: string }> = [
  { key: "RELIABLE", label: "Надійні", tone: "good", desc: "борг у межах робочого кредиту" },
  { key: "MODERATE", label: "Помірні", tone: "neutral", desc: "борг понад місяць обороту або перша прострочка" },
  { key: "RISKY", label: "Ризикові", tone: "warn", desc: "прострочено понад 20% або два місяці обороту в борзі" },
  { key: "CRITICAL", label: "Лише передоплата", tone: "bad", desc: "прострочено більшість боргу або борг без покупок" },
];

const TONE: Record<Verdict, "good" | "warn" | "bad" | "neutral"> = {
  RELIABLE: "good",
  MODERATE: "neutral",
  RISKY: "warn",
  CRITICAL: "bad",
};

const LABEL: Record<Verdict, string> = {
  RELIABLE: "надійний",
  MODERATE: "помірний",
  RISKY: "ризиковий",
  CRITICAL: "передоплата",
};

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—";
}

export function PayersTab() {
  const { data, loading, error, reload } = useApi<DisciplineResponse>(
    "/api/admin/sales-analytics/clients/discipline"
  );
  const [filter, setFilter] = useState<Verdict | "">("");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.rows.filter(
      (r) =>
        (!filter || r.verdict === filter) &&
        (!q || r.name.toLowerCase().includes(q) || (r.repName ?? "").toLowerCase().includes(q))
    );
  }, [data, filter, search]);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <TableSkeleton rows={10} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {VERDICTS.map((v) => {
          const s = data.totals.byVerdict[v.key];
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setFilter(filter === v.key ? "" : v.key)}
              aria-pressed={filter === v.key}
              className={`cursor-pointer rounded-[var(--radius-card)] text-left transition-shadow ${
                filter === v.key ? "ring-2 ring-bk" : ""
              }`}
            >
              <StatCard
                label={v.label}
                value={num(s.clients)}
                unit="кл."
                tone={s.clients > 0 ? v.tone : "neutral"}
                hint={`борг ${money(s.debt)} ₴ · ${v.desc}`}
              />
            </button>
          );
        })}
      </div>

      <p className="text-xs text-g500">
        Вік боргу відновлено за FIFO по відвантаженнях (та сама логіка, що в дебіторці).
        «Дн. обороту в борзі» — борг, поділений на середньоденний оборот клієнта за
        останні {data.velocityDays} днів. Оплати в базі з {data.paymentsSince ?? "—"}.
        Рекомендований ліміт — орієнтир від середньомісячного обороту, а не правило.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Пошук: клієнт або торговий"
          className="w-64 rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-2 text-sm text-bk"
          aria-label="Пошук клієнта"
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter("")}
            className="cursor-pointer rounded-[var(--radius-btn)] bg-g100 px-3 py-1.5 text-xs font-medium text-g600 hover:text-bk"
          >
            Скинути фільтр
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="Нікого не знайдено" hint="Змініть фільтр або пошук." />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title={`Клієнти (${num(rows.length)})`}
              hint="Найпроблемніші зверху: критичні за сумою боргу, далі ризикові"
            />
          </div>
          <TableScroll minWidth={960}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Клієнт</th>
                  <th className="px-4 py-2.5">Вердикт</th>
                  <th className="px-4 py-2.5 text-right">Борг, грн</th>
                  <th className="px-4 py-2.5 text-right">Простроч.</th>
                  <th className="px-4 py-2.5 text-right">Дн. обороту в борзі</th>
                  <th className="px-4 py-2.5 text-right">Оборот/міс</th>
                  <th className="px-4 py-2.5 text-right">Оплачено за 90 дн.</th>
                  <th className="px-4 py-2.5 text-right">Рек. ліміт</th>
                  <th className="px-4 py-2.5">Торговий</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {rows.slice(0, 300).map((r) => (
                  <tr key={r.counterpartyId} className="transition-colors hover:bg-g50">
                    <td className="px-4 py-3">
                      <span className="text-bk">{r.name}</span>
                      <span className="block text-[11px] text-g400">
                        останнє відвантаження {fmtDate(r.lastDocAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={TONE[r.verdict]}>{LABEL[r.verdict]}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                      {r.debt > 0 ? money(r.debt) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.overdue > 0 ? (
                        <span className="text-red-600">
                          {money(r.overdue)}
                          <span className="block text-[11px] text-g400">{num(r.overdueShare, 0)}%</span>
                        </span>
                      ) : (
                        <span className="text-g400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">
                      {r.debt <= 0 ? "—" : r.debtDays === null ? (
                        <span className="text-red-600" title="Борг є, покупок за вікно немає">не купує</span>
                      ) : (
                        num(Math.round(r.debtDays))
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{money(r.perMonth)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">
                      {r.paid > 0 ? money(r.paid) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-bk">
                      {r.suggestedLimit > 0 ? money(r.suggestedLimit) : "0"}
                    </td>
                    <td className="px-4 py-3 text-g600">{r.repName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          {rows.length > 300 && (
            <p className="px-4 py-3 text-xs text-g500">
              Показано перші 300. Звузьте пошуком або фільтром.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
