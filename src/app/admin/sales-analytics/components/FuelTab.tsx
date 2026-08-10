"use client";

import { useState } from "react";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, money, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useApi } from "./useApi";
import { ErrorBox } from "./ErrorBox";

/**
 * Логістика: кілометраж із бота × норма авто × ціна пального.
 *
 * Особисті км (різниця між одометром на старті і кінцем попередньої поїздки)
 * у розрахунок не входять — їх торговий заправляє сам.
 */

type FuelResponse = {
  period: { from: string; to: string; days: number };
  canEdit: boolean;
  defaults: { fuelConsumption: number; fuelPricePerL: number };
  rows: Array<{
    repId: string;
    repName: string;
    label: string | null;
    hasVehicle: boolean;
    fuelConsumption: number;
    fuelPricePerL: number;
    totalKm: number;
    personalKm: number;
    workKm: number;
    trips: number;
    daysWorked: number;
    liters: number;
    cost: number;
    costPerDay: number;
  }>;
  totals: { workKm: number; liters: number; cost: number };
};

export function FuelTab({ period }: { period: Period }) {
  const { data, loading, error, reload } = useApi<FuelResponse>(
    `/api/admin/sales-vehicles?from=${period.from}&to=${period.to}`
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", fuelConsumption: "", fuelPricePerL: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function saveVehicle(repId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/sales-vehicles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repId,
          label: form.label || null,
          fuelConsumption: Number(form.fuelConsumption),
          fuelPricePerL: Number(form.fuelPricePerL),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти");
      setEditing(null);
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Помилка збереження");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <TableSkeleton rows={5} cols={6} />;
  if (!data) return null;

  if (data.rows.length === 0) {
    return (
      <Card>
        <EmptyState title="Немає торгових" hint="Авто заводяться користувачам із роллю SALES." />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Робочі км" value={num(data.totals.workKm)} unit="км" hint="без особистих" />
        <StatCard label="Пальне" value={num(data.totals.liters)} unit="л" />
        <StatCard label="Вартість" value={money(data.totals.cost)} unit="грн" />
        <StatCard
          label="У середньому"
          value={money(data.totals.workKm > 0 ? data.totals.cost / data.totals.workKm : 0)}
          unit="грн/км"
        />
      </div>

      {message && <ErrorBox message={message} />}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Авто та витрати на пальне"
            hint={`Формула: робочі км ÷ 100 × норма × ціна. Без авто застосовується ${data.defaults.fuelConsumption} л/100км і ${data.defaults.fuelPricePerL} грн/л.`}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                <th className="px-4 py-2.5">Торговий</th>
                <th className="px-4 py-2.5">Авто</th>
                <th className="px-4 py-2.5 text-right">Норма</th>
                <th className="px-4 py-2.5 text-right">Ціна</th>
                <th className="px-4 py-2.5 text-right">Робочі км</th>
                <th className="px-4 py-2.5 text-right">Особисті</th>
                <th className="px-4 py-2.5 text-right">Літрів</th>
                <th className="px-4 py-2.5 text-right">Вартість</th>
                <th className="px-4 py-2.5 text-right">грн/день</th>
                {data.canEdit && <th className="px-4 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-g100">
              {data.rows.map((r) => {
                const isEditing = editing === r.repId;
                return (
                  <tr key={r.repId} className="hover:bg-g50">
                    <td className="px-4 py-3 font-medium text-bk">
                      {r.repName}
                      {r.trips > 0 && (
                        <span className="ml-2 text-xs text-g400">
                          {r.trips} поїзд. / {r.daysWorked} дн.
                        </span>
                      )}
                    </td>

                    {isEditing ? (
                      <>
                        <td className="px-4 py-2">
                          <input
                            value={form.label}
                            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                            placeholder="Renault Kangoo"
                            aria-label="Марка авто"
                            className="w-40 rounded-[var(--radius-badge)] border border-g200 px-2 py-1 text-xs text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number"
                            step={0.1}
                            min={0}
                            value={form.fuelConsumption}
                            onChange={(e) => setForm((f) => ({ ...f, fuelConsumption: e.target.value }))}
                            aria-label="Норма витрати, л/100км"
                            className="w-20 rounded-[var(--radius-badge)] border border-g200 px-2 py-1 text-right text-xs tabular-nums text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number"
                            step={0.5}
                            min={0}
                            value={form.fuelPricePerL}
                            onChange={(e) => setForm((f) => ({ ...f, fuelPricePerL: e.target.value }))}
                            aria-label="Ціна пального, грн/л"
                            className="w-20 rounded-[var(--radius-badge)] border border-g200 px-2 py-1 text-right text-xs tabular-nums text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-g600">
                          {r.label ?? <span className="text-g400">не вказано</span>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-g600">
                          {num(r.fuelConsumption, 1)}
                          <span className="ml-1 text-xs text-g400">л</span>
                          {!r.hasVehicle && <span className="ml-1 text-[11px] text-amber-600">за замовч.</span>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-g600">{num(r.fuelPricePerL, 2)}</td>
                      </>
                    )}

                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">{num(r.workKm)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-g500">
                      {r.personalKm > 0 ? num(r.personalKm) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{num(r.liters, 1)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">{money(r.cost)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{money(r.costPerDay)}</td>

                    {data.canEdit && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isEditing ? (
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => saveVehicle(r.repId)}
                              disabled={busy}
                              className="cursor-pointer rounded-[var(--radius-badge)] bg-primary px-2.5 py-1 text-xs font-semibold text-bk transition-colors hover:bg-primary-hover disabled:opacity-60"
                            >
                              OK
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className="cursor-pointer rounded-[var(--radius-badge)] border border-g200 px-2.5 py-1 text-xs text-g600 transition-colors hover:border-g300"
                            >
                              Скасувати
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(r.repId);
                              setForm({
                                label: r.label ?? "",
                                fuelConsumption: String(r.fuelConsumption),
                                fuelPricePerL: String(r.fuelPricePerL),
                              });
                            }}
                            className="cursor-pointer rounded-[var(--radius-badge)] border border-g200 px-2.5 py-1 text-xs text-g600 transition-colors hover:border-g300 hover:text-bk"
                          >
                            Змінити
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
