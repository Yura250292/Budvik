"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { ProgressBar, StatCard, money } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { kyivToday } from "@/components/ui/PeriodPicker";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { ColorDot } from "@/components/ui/Badge";
import { RepFilter, useRepFilter } from "@/components/ui/RepFilter";
import { CATEGORICAL, STATUS, attainmentStatus } from "@/lib/analytics/colors";
import { attainmentPercent } from "@/lib/motivation/engine";

/**
 * КПІ: місячні плани обороту, торговий × фірма (бренд).
 *
 * Два режими однієї таблиці — введення планів і перегляд виконання. Робити
 * з них дві сторінки означало б клацати туди-сюди, щоб зрозуміти, який план
 * поставити наступного місяця.
 */

type PlansResponse = {
  month: string;
  canEdit: boolean;
  plans: Array<{ id: string; repId: string | null; brandId: string | null; targetValue: number }>;
  reps: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string; color: string | null }>;
};

type AttainmentResponse = {
  month: string;
  rows: Array<{
    repId: string;
    repName: string;
    brandId: string | null;
    brandName: string | null;
    target: number;
    actual: number;
    attainment: number;
  }>;
  totals: { target: number; actual: number; attainment: number };
};

const cellKey = (repId: string, brandId: string | null) => `${repId}::${brandId ?? ""}`;

export function PlansTab() {
  const [month, setMonth] = useState(() => kyivToday().slice(0, 7));
  const [mode, setMode] = useState<"edit" | "view">("view");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const repFilter = useRepFilter("kpi.plans.hiddenReps");

  const plans = useApi<PlansResponse>(`/api/admin/sales-plans?month=${month}`);
  const attainment = useApi<AttainmentResponse>(`/api/admin/sales-plans/attainment?month=${month}`);

  // Чернетка перезаливається з сервера при зміні місяця — інакше значення
  // попереднього місяця «перетікали» б у новий і збереглися випадково.
  useEffect(() => {
    if (!plans.data) return;
    const next: Record<string, string> = {};
    for (const p of plans.data.plans) {
      if (!p.repId) continue;
      next[cellKey(p.repId, p.brandId)] = String(p.targetValue);
    }
    setDraft(next);
    setSaved(null);
  }, [plans.data]);

  const actualByCell = useMemo(() => {
    const map = new Map<string, { actual: number; attainment: number }>();
    for (const r of attainment.data?.rows ?? []) {
      map.set(cellKey(r.repId, r.brandId), { actual: r.actual, attainment: r.attainment });
    }
    return map;
  }, [attainment.data]);

  // Картки згори рахуються по видимих торгових. Інакше «План команди» лишався б
  // загальним, а таблиця під ним — урізаною, і числа не сходились би.
  const { hiddenIds } = repFilter;
  const totals = useMemo(() => {
    const rows = attainment.data?.rows;
    if (!rows) return null;
    let target = 0;
    let actual = 0;
    for (const r of rows) {
      if (r.brandId !== null || hiddenIds.has(r.repId)) continue;
      target += r.target;
      actual += r.actual;
    }
    return { target, actual, attainment: attainmentPercent("REVENUE", actual, target) };
  }, [attainment.data, hiddenIds]);

  async function save() {
    if (!plans.data) return;
    setSaving(true);
    setSaved(null);

    const entries = Object.entries(draft).map(([key, value]) => {
      const [repId, brandId] = key.split("::");
      return { repId, brandId: brandId || null, targetValue: Number(value.replace(/\s/g, "")) || 0 };
    });

    try {
      const res = await fetch("/api/admin/sales-plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, entries }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти");
      setSaved(`Збережено: ${json.saved}, знято: ${json.removed}`);
      plans.reload();
      attainment.reload();
    } catch (e) {
      setSaved(e instanceof Error ? e.message : "Помилка збереження");
    } finally {
      setSaving(false);
    }
  }

  const error = plans.error ?? attainment.error;
  if (error) return <ErrorBox message={error} onRetry={() => { plans.reload(); attainment.reload(); }} />;
  if (plans.loading && !plans.data) return <TableSkeleton rows={6} cols={5} />;
  if (!plans.data) return null;

  const { reps: allReps, brands, canEdit } = plans.data;
  const reps = repFilter.apply(allReps);

  if (allReps.length === 0) {
    return (
      <Card>
        <EmptyState title="Немає торгових" hint="Плани ставляться користувачам із роллю SALES." />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor="plan-month" className="text-xs font-medium text-g500">
            Місяць:
          </label>
          <input
            id="plan-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value || kyivToday().slice(0, 7))}
            className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-xs text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <RepFilter
            reps={allReps}
            hiddenIds={repFilter.hiddenIds}
            onChange={repFilter.setHidden}
          />
          {(["view", "edit"] as const).map((m) => {
            if (m === "edit" && !canEdit) return null;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={`cursor-pointer rounded-[var(--radius-btn)] px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
                  mode === m ? "bg-bk text-white" : "border border-g200 bg-white text-g600 hover:border-g300 hover:text-bk"
                }`}
              >
                {m === "view" ? "Виконання" : "Редагувати плани"}
              </button>
            );
          })}
        </div>
      </div>

      {totals && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="План команди" value={money(totals.target)} unit="грн" accent="var(--color-g300)" />
          <StatCard label="Факт" value={money(totals.actual)} unit="грн" accent={CATEGORICAL[0]} />
          <StatCard
            label="Виконання"
            value={`${Math.round(totals.attainment)}%`}
            tone={attainmentStatus(totals.attainment, totals.target > 0)}
          />
          <StatCard label="Залишилось" value={money(Math.max(0, totals.target - totals.actual))} unit="грн" />
        </div>
      )}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title={mode === "edit" ? "Плани обороту на місяць" : "Виконання планів"}
            hint={
              mode === "edit"
                ? "Порожнє або 0 = плану немає. «Загальний» — план на весь оборот, колонки брендів — окремо по фірмах."
                : "Факт по бренду рахується з позицій документів, загальний — із сум документів."
            }
            action={
              mode === "edit" ? (
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-4 py-2 text-xs font-semibold text-bk transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Збереження…" : "Зберегти"}
                </button>
              ) : undefined
            }
          />
          {saved && <p className="-mt-2 mb-2 text-xs text-g600">{saved}</p>}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                <th className="sticky left-0 z-10 bg-g50 px-4 py-2.5">Торговий</th>
                <th className="px-3 py-2.5 text-right">Загальний</th>
                {brands.map((b) => (
                  <th key={b.id} className="px-3 py-2.5 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <ColorDot color={b.color ?? "var(--color-g300)"} size={8} />
                      {b.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-g100">
              {reps.length === 0 && (
                <tr>
                  <td colSpan={brands.length + 2} className="px-4 py-6 text-center text-xs text-g500">
                    Усіх торгових приховано фільтром. Збережені плани не зникли — поверніть когось у список.
                  </td>
                </tr>
              )}
              {reps.map((rep) => (
                <tr key={rep.id} className="hover:bg-g50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2.5 font-medium text-bk">{rep.name}</td>
                  {[null, ...brands.map((b) => b.id)].map((brandId) => {
                    const key = cellKey(rep.id, brandId);
                    const fact = actualByCell.get(key);
                    const target = Number(draft[key] ?? 0);

                    return (
                      <td key={key} className="px-3 py-2.5 text-right align-middle">
                        {mode === "edit" ? (
                          <input
                            type="number"
                            min={0}
                            step={1000}
                            inputMode="numeric"
                            value={draft[key] ?? ""}
                            onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                            placeholder="—"
                            aria-label={`План ${rep.name}, ${brandId ? brands.find((b) => b.id === brandId)?.name : "загальний"}`}
                            className="w-28 rounded-[var(--radius-badge)] border border-g200 px-2 py-1 text-right text-xs tabular-nums text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
                          />
                        ) : (
                          <div className="min-w-[7rem]">
                            <div className="text-xs tabular-nums">
                              <span
                                className="font-semibold"
                                style={{
                                  color:
                                    target > 0
                                      ? STATUS[attainmentStatus(fact?.attainment ?? 0)].fg
                                      : "var(--color-bk)",
                                }}
                              >
                                {money(fact?.actual ?? 0)}
                              </span>
                              {target > 0 && <span className="text-g400"> / {money(target)}</span>}
                            </div>
                            {target > 0 ? (
                              <div className="mt-1">
                                <ProgressBar percent={fact?.attainment ?? 0} height={4} showValue={false} />
                              </div>
                            ) : (
                              <span className="text-[11px] text-g400">без плану</span>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
