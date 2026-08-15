"use client";

/**
 * ABC/XYZ — на чому тримається оборот і на що можна планувати склад.
 *
 * Порядок екрана повторює порядок питань: спершу структура (скільки позицій
 * дають 80% грошей), далі матриця рішень (що тримати, що возити під
 * замовлення, що виводити), і лише потім сам список.
 *
 * Матриця важливіша за таблицю, тому стоїть вище: у 4 тисячах позицій
 * закономірність видно тільки згорткою.
 */

import { useState } from "react";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, money, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { Badge } from "@/components/ui/Badge";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";

type AbcClass = "A" | "B" | "C";
type XyzClass = "X" | "Y" | "Z";
type Dimension = "product" | "brand" | "client";

type AbcResponse = {
  period: { from: string; to: string; days: number; clamped: boolean };
  dimension: Dimension;
  months: number;
  xyzAvailable: boolean;
  total: number;
  truncated: boolean;
  rows: Array<{
    id: string;
    name: string;
    brandName?: string | null;
    amount: number;
    qty: number;
    docs: number;
    share: number;
    cumShare: number;
    abc: AbcClass;
    xyz: XyzClass | null;
    variation: number | null;
    activeMonths: number;
  }>;
  summary: Array<{
    abc: AbcClass;
    count: number;
    amount: number;
    countShare: number;
    amountShare: number;
  }>;
  matrix: Array<{ abc: AbcClass; xyz: XyzClass; count: number; amount: number }>;
};

const DIMENSIONS: Array<{ key: Dimension; label: string }> = [
  { key: "product", label: "Товари" },
  { key: "brand", label: "Бренди" },
  { key: "client", label: "Клієнти" },
];

/** Що клас означає для рішення, а не що він означає формально. */
const ABC_MEANING: Record<AbcClass, string> = {
  A: "дають 80% обороту",
  B: "наступні 15%",
  C: "останні 5% — довгий хвіст",
};

const XYZ_MEANING: Record<XyzClass, string> = {
  X: "рівний попит",
  Y: "коливний попит",
  Z: "епізодичний попит",
};

/**
 * Порада для кожної клітинки матриці. Саме заради неї матриця й будується:
 * пара літер сама по собі нікому нічого не каже.
 */
const ADVICE: Record<string, string> = {
  AX: "Тримати завжди. Дефіцит тут — прямі втрати грошей.",
  AY: "Тримати із запасом на коливання.",
  AZ: "Гроші є, момент непередбачуваний — возити під замовлення.",
  BX: "Регулярний товар, помірний запас.",
  BY: "Стежити за залишком, закуповувати партіями.",
  BZ: "Під замовлення або мінімальний запас.",
  CX: "Дешево тримати, попит рівний — хай лежить.",
  CY: "Мінімальний запас.",
  CZ: "Кандидати на виведення з асортименту.",
};

function abcTone(cls: AbcClass): "good" | "warn" | "neutral" {
  return cls === "A" ? "good" : cls === "B" ? "warn" : "neutral";
}

export function AbcTab({ period, rep }: { period: Period; rep: string | null }) {
  const [dimension, setDimension] = useState<Dimension>("product");

  const repParam = rep ? `&rep=${rep}` : "";
  const { data, loading, error, reload } = useApi<AbcResponse>(
    `/api/admin/sales-analytics/abc?from=${period.from}&to=${period.to}&dimension=${dimension}${repParam}`
  );

  const switcher = (
    <div className="flex gap-1" role="group" aria-label="Вимір аналізу">
      {DIMENSIONS.map((d) => (
        <button
          key={d.key}
          type="button"
          onClick={() => setDimension(d.key)}
          aria-pressed={dimension === d.key}
          className={`cursor-pointer rounded-[var(--radius-btn)] px-3 py-1.5 text-[13px] font-medium transition-colors ${
            dimension === d.key ? "bg-bk text-white" : "bg-g100 text-g600 hover:text-bk"
          }`}
        >
          {d.label}
        </button>
      ))}
    </div>
  );

  if (error) return <ErrorBox message={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {switcher}
        {data && !data.xyzAvailable && (
          <p className="text-xs text-g500">
            XYZ потребує щонайменше трьох місяців — у періоді {num(data.months)}.
          </p>
        )}
      </div>

      {loading && <TableSkeleton rows={8} />}

      {!loading && data && data.rows.length === 0 && (
        <Card>
          <EmptyState
            title="Немає продажів за період"
            hint={`За ${data.period.from} — ${data.period.to} жодної реалізації не знайдено.`}
          />
        </Card>
      )}

      {!loading && data && data.rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {data.summary.map((s) => (
              <StatCard
                key={s.abc}
                label={`Клас ${s.abc}`}
                value={num(s.count)}
                unit={dimension === "client" ? "клієнтів" : dimension === "brand" ? "брендів" : "позицій"}
                tone={abcTone(s.abc)}
                hint={`${num(s.countShare, 1)}% списку → ${num(s.amountShare, 1)}% обороту (${money(s.amount)} ₴)`}
              />
            ))}
            <StatCard
              label="Оборот за період"
              value={money(data.total)}
              unit="₴"
              hint={`${ABC_MEANING.A} — ${num(data.summary.find((s) => s.abc === "A")?.count ?? 0)} шт.`}
            />
          </div>

          {data.xyzAvailable && data.matrix.length > 0 && (
            <Card padded={false}>
              <div className="p-4 sm:p-5">
                <CardHeader
                  title="Матриця рішень ABC × XYZ"
                  hint="Рядки — внесок у гроші, колонки — передбачуваність попиту. Місяць без продажів рахується нулем, тому епізодичний товар не виглядає стабільним."
                />
              </div>
              <TableScroll minWidth={640}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                      <th className="px-4 py-2.5">Клас</th>
                      <th className="px-4 py-2.5">X — {XYZ_MEANING.X}</th>
                      <th className="px-4 py-2.5">Y — {XYZ_MEANING.Y}</th>
                      <th className="px-4 py-2.5">Z — {XYZ_MEANING.Z}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-g100">
                    {(["A", "B", "C"] as const).map((abc) => (
                      <tr key={abc}>
                        <td className="px-4 py-3 align-top">
                          <Badge status={abcTone(abc)}>{abc}</Badge>
                          <span className="mt-1 block text-[11px] text-g400">{ABC_MEANING[abc]}</span>
                        </td>
                        {(["X", "Y", "Z"] as const).map((xyz) => {
                          const cell = data.matrix.find((m) => m.abc === abc && m.xyz === xyz);
                          if (!cell) {
                            return (
                              <td key={xyz} className="px-4 py-3 align-top text-g300">
                                —
                              </td>
                            );
                          }
                          return (
                            <td key={xyz} className="px-4 py-3 align-top">
                              <span className="font-semibold tabular-nums text-bk">{num(cell.count)}</span>
                              <span className="ml-1 text-xs text-g500">поз.</span>
                              <span className="block text-xs tabular-nums text-g600">
                                {money(cell.amount)} ₴
                              </span>
                              <span className="mt-1 block text-[11px] leading-snug text-g400">
                                {ADVICE[`${abc}${xyz}`]}
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
          )}

          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardHeader
                title="Рейтинг за оборотом"
                hint={
                  data.truncated
                    ? `Показано перші ${num(data.rows.length)} рядків. Підсумки й матриця вище рахуються за повним списком.`
                    : "Накопичена частка показує, де проходить межа класів"
                }
              />
            </div>
            <TableScroll minWidth={820}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                    <th className="px-4 py-2.5">
                      {dimension === "client" ? "Клієнт" : dimension === "brand" ? "Бренд" : "Товар"}
                    </th>
                    <th className="px-4 py-2.5 text-right">Оборот, грн</th>
                    <th className="px-4 py-2.5 text-right">Частка</th>
                    <th className="px-4 py-2.5 text-right">Накопичено</th>
                    <th className="px-4 py-2.5 text-right">Док.</th>
                    <th className="px-4 py-2.5 text-center">ABC</th>
                    <th className="px-4 py-2.5 text-center">XYZ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-g100">
                  {data.rows.map((r) => (
                    <tr key={r.id} className="transition-colors hover:bg-g50">
                      <td className="px-4 py-3">
                        <span className="text-bk">{r.name}</span>
                        {r.brandName && (
                          <span className="block text-[11px] text-g400">{r.brandName}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                        {money(r.amount)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">
                        {num(r.share, 1)}%
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-g500">
                        {num(r.cumShare, 1)}%
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">{num(r.docs)}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge status={abcTone(r.abc)}>{r.abc}</Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r.xyz ? (
                          <span title={`Варіація ${num(r.variation ?? 0, 2)}; продажі в ${r.activeMonths} міс. з ${data.months}`}>
                            <Badge status="neutral">{r.xyz}</Badge>
                          </span>
                        ) : (
                          <span className="text-xs text-g400">мало даних</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Card>
        </>
      )}
    </div>
  );
}
