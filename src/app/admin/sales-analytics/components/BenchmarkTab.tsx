"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { money, num } from "@/components/ui/Stat";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { STATUS, CATEGORICAL, NEUTRAL } from "@/lib/analytics/colors";
import { useApi } from "./useApi";
import { ErrorBox } from "./ErrorBox";
import { InsightsPanel } from "./InsightsPanel";
import type { Period } from "@/components/ui/PeriodPicker";
import { METRICS, type MetricKey } from "@/lib/analytics/benchmarkMetrics";

/**
 * Порівняння команди: хто де сильний, хто де провисає.
 *
 * Зведена вкладка вже показує абсолютні числа кожного. Тут інше питання —
 * чи це багато відносно решти: замість «оборот 920 тис.» керівник бачить
 * «п'ятий з дев'яти, але найкращий за новими клієнтами».
 *
 * Кожне число супроводжується перцентилем, і колір ніколи не єдиний
 * носій сенсу — поруч завжди цифра.
 */

type BenchmarkResponse = {
  period: { from: string; to: string; days: number };
  reps: Array<
    { repId: string; name: string; place: number; strengths: MetricKey[]; weaknesses: MetricKey[] } & Record<
      MetricKey,
      number | null
    > & { ranks: Record<MetricKey, number | null> }
  >;
  medians: Record<MetricKey, number | null>;
  brandMatrix: Array<{
    brandId: string | null;
    brandName: string;
    byRep: Record<string, number>;
    total: number;
    coverage: number;
    missingRepIds: string[];
  }>;
  comparable: boolean;
};

/** Колонки таблиці в порядку читання: спершу обсяг, далі якість роботи. */
const COLUMNS: MetricKey[] = [
  "revenue",
  "docs",
  "clients",
  "avgCheck",
  "collected",
  "overdueRatio",
  "newClients",
  "lostClients",
  "momentumPct",
  "skuPerClient",
  "brandCount",
];

function formatMetric(key: MetricKey, value: number | null): string {
  if (value === null) return "н/д";
  const unit = METRICS[key].unit;
  if (unit === "uah") return money(value);
  if (unit === "pct") return `${Math.round(value)}%`;
  return num(value, key === "skuPerClient" ? 1 : 0);
}

/**
 * Колір клітинки за перцентилем.
 *
 * Заливка навмисно бліда: сильних і слабких у таблиці має бути видно
 * периферійним зором, але читати треба число, а не колір.
 */
function cellStyle(rank: number | null): React.CSSProperties | undefined {
  if (rank === null) return undefined;
  if (rank >= 75) return { backgroundColor: STATUS.good.bg, color: STATUS.good.fg };
  if (rank <= 25) return { backgroundColor: STATUS.bad.bg, color: STATUS.bad.fg };
  return undefined;
}

/** Матриця бренд × торговий: показуємо лише те, що справді має покриття. */
const MATRIX_LIMIT = 15;

export function BenchmarkTab({ period }: { period: Period }) {
  const { data, loading, error, reload } = useApi<BenchmarkResponse>(
    `/api/admin/sales-analytics/benchmark?from=${period.from}&to=${period.to}`
  );
  const [showMatrix, setShowMatrix] = useState(false);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <CardSkeleton rows={8} />;
  if (!data) return null;

  if (data.reps.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Немає продажів за період"
          hint="Жоден торговий не має проведених реалізацій у цьому діапазоні."
        />
      </Card>
    );
  }

  const gaps = data.brandMatrix
    .filter((b) => b.coverage < 1 && b.coverage > 0 && b.missingRepIds.length > 0)
    .slice(0, MATRIX_LIMIT);

  return (
    <div className="space-y-4">
      <InsightsPanel
        endpoint={`/api/admin/sales-analytics/insights/team?from=${period.from}&to=${period.to}`}
        title="АІ-аналіз команди"
        hint="Хто витягує команду, хто провисає і в чому саме. Порівняння за перцентилями, числа пораховані з бази."
        saveContext={{ kind: "team", fromDay: period.from, toDay: period.to }}
      />

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Порівняння команди"
            hint={
              data.comparable
                ? "Заливка показує перцентиль по команді: зелене — верхня чверть, червоне — нижня. Дебіторка й втрачені клієнти рахуються навпаки — менше означає краще."
                : "Торгових замало для порівняння — показані лише абсолютні числа."
            }
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                <th className="sticky left-0 z-10 bg-g50 px-4 py-2.5">Торговий</th>
                {COLUMNS.map((key) => (
                  <th key={key} className="px-3 py-2.5 text-right">
                    {METRICS[key].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-g100">
              {data.reps.map((rep) => (
                <tr key={rep.repId} className="hover:bg-g50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2.5 hover:bg-g50">
                    <Link
                      href={`/admin/sales-analytics/${rep.repId}?from=${period.from}&to=${period.to}`}
                      className="cursor-pointer font-medium text-bk hover:underline"
                    >
                      {rep.name}
                    </Link>
                    <span className="block text-xs text-g400">{rep.place} місце за оборотом</span>
                  </td>
                  {COLUMNS.map((key) => (
                    <td
                      key={key}
                      className="px-3 py-2.5 text-right tabular-nums"
                      style={cellStyle(rep.ranks[key])}
                    >
                      <span className="font-medium">{formatMetric(key, rep[key])}</span>
                      {rep.ranks[key] !== null && (
                        <span className="block text-[10px] font-normal opacity-70">
                          {Math.round(rep.ranks[key]!)} перц.
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}

              <tr className="border-t-2 border-g200 bg-g50 text-xs">
                <td className="sticky left-0 z-10 bg-g50 px-4 py-2.5 font-semibold text-g600">
                  Медіана команди
                </td>
                {COLUMNS.map((key) => (
                  <td key={key} className="px-3 py-2.5 text-right font-semibold tabular-nums text-g600">
                    {formatMetric(key, data.medians[key])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* --- Кого куди підтягувати --- */}
      {data.comparable && (
        <Card>
          <CardHeader
            title="Сильні та слабкі сторони"
            hint="Відносно решти команди, а не абсолютно: слабка сторона в сильного торгового — це все одно тема для розмови."
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.reps.map((rep) => (
              <div key={rep.repId} className="rounded-[var(--radius-card)] border border-g200 p-3">
                <Link
                  href={`/admin/sales-analytics/${rep.repId}?from=${period.from}&to=${period.to}`}
                  className="cursor-pointer font-medium text-bk hover:underline"
                >
                  {rep.name}
                </Link>
                <dl className="mt-2 space-y-1.5 text-xs">
                  <div>
                    <dt className="font-medium" style={{ color: STATUS.good.fg }}>
                      Сильні
                    </dt>
                    <dd className="text-g600">
                      {rep.strengths.length > 0
                        ? rep.strengths.map((k) => METRICS[k].label).join(", ")
                        : "немає метрик у верхній чверті"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium" style={{ color: STATUS.bad.fg }}>
                      Підтягнути
                    </dt>
                    <dd className="text-g600">
                      {rep.weaknesses.length > 0
                        ? rep.weaknesses.map((k) => METRICS[k].label).join(", ")
                        : "немає метрик у нижній чверті"}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* --- Матриця брендів --- */}
      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Бренди по торгових"
            hint="Порожня клітинка — бренд, який возить команда, а цей торговий не продав жодної одиниці. Це не оцінка, а тема для розмови."
          />
          {gaps.length === 0 ? (
            <EmptyState
              title="Прогалин немає"
              hint="Кожен бренд із продажами возять усі торгові, у кого були реалізації."
            />
          ) : (
            <>
              <p className="text-sm text-g600">
                {gaps.length} {gaps.length === 1 ? "бренд має" : "бренди мають"} неповне покриття командою.
              </p>
              <button
                type="button"
                onClick={() => setShowMatrix((v) => !v)}
                className="mt-2 cursor-pointer text-xs font-medium text-bk underline underline-offset-2"
              >
                {showMatrix ? "Згорнути матрицю" : "Показати матрицю"}
              </button>
            </>
          )}
        </div>

        {showMatrix && gaps.length > 0 && (
          <div className="overflow-x-auto border-t border-g100">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="sticky left-0 z-10 bg-g50 px-4 py-2.5">Бренд</th>
                  <th className="px-3 py-2.5 text-right">Разом</th>
                  {data.reps.map((r) => (
                    <th key={r.repId} className="px-3 py-2.5 text-right">
                      <span className="block max-w-[90px] truncate">{r.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {gaps.map((b, i) => (
                  <tr key={b.brandId ?? i} className="hover:bg-g50">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2.5 hover:bg-g50">
                      <span className="inline-flex items-center gap-2">
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: CATEGORICAL[i % CATEGORICAL.length] ?? NEUTRAL }}
                        />
                        <span className="text-bk">{b.brandName}</span>
                      </span>
                      <span className="block text-xs text-g400">
                        покриття {Math.round(b.coverage * 100)}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-bk">
                      {money(b.total)}
                    </td>
                    {data.reps.map((r) => {
                      const value = b.byRep[r.repId] ?? 0;
                      return (
                        <td
                          key={r.repId}
                          className="px-3 py-2.5 text-right tabular-nums"
                          style={value <= 0 ? { backgroundColor: STATUS.bad.bg, color: STATUS.bad.fg } : undefined}
                        >
                          {value > 0 ? money(value) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
