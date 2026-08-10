"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { ProgressBar, StatCard, money } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { kyivToday } from "@/components/ui/PeriodPicker";
import { useApi } from "./useApi";
import { ErrorBox } from "./ErrorBox";

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

  const { reps, brands, canEdit } = plans.data;
  const totals = attainment.data?.totals;

  if (reps.length === 0) {
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
          <StatCard label="План команди" value={money(totals.target)} unit="грн" />
          <StatCard label="Факт" value={money(totals.actual)} unit="грн" />
          <StatCard
            label="Виконання"
            value={`${Math.round(totals.attainment)}%`}
            tone={totals.attainment >= 100 ? "good" : totals.attainment >= 70 ? "warn" : "bad"}
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
                    {b.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-g100">
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
                            <div className="text-xs tabular-nums text-bk">
                              {money(fact?.actual ?? 0)}
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
