"use client";

import { useState } from "react";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, money, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { CATEGORICAL } from "@/lib/analytics/colors";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { TableScroll } from "@/components/ui/TableScroll";

/**
 * Зарплата водіїв за маршрутними листами.
 *
 * Кожен рядок розгортається до листів, кожен лист — до рядків нарахування
 * з поясненням. Це не декор: водій має бачити, звідки взялася сума, інакше
 * будь-яка розбіжність із його власним підрахунком перетворюється на спір
 * без даних.
 */

type PayrollLine = {
  kind: string;
  label: string;
  base: number;
  amount: number;
  explanation: string;
};

type PayrollResponse = {
  period: { from: string; to: string; days: number };
  canEdit: boolean;
  rates: { cityPointRate: number; oblastPointRate: number; turnoverPercent: number };
  unmappedSheets: number;
  rows: Array<{
    driverId: string;
    driverName: string;
    mapped: boolean;
    sheetsCount: number;
    totalKm: number;
    cityPoints: number;
    oblastPoints: number;
    turnoverBase: number;
    sheetsTotal: number;
    bonusesTotal: number;
    total: number;
    sheets: Array<{
      routeSheetId: string;
      source: "SITE" | "SHEET_1C";
      number: string;
      day: string;
      distanceKm: number;
      /** MANUAL — факт від адміна, PLAN — планові км OSRM, SHEET — з 1С */
      kmSource: "MANUAL" | "PLAN" | "SHEET" | "NONE";
      plannedKm: number | null;
      cityPoints: number;
      oblastPoints: number;
      unknownZonePoints: number;
      ordersTotal: number;
      debtsTotal: number;
      total: number;
      lines: PayrollLine[];
    }>;
    bonuses: Array<{
      id: string;
      day: string;
      amount: number;
      reason: string;
      createdByName: string | null;
    }>;
  }>;
  totals: {
    sheetsCount: number;
    totalKm: number;
    sheetsTotal: number;
    bonusesTotal: number;
    total: number;
  };
};

export function PayrollTab({
  period,
  onOpenSettings,
}: {
  period: Period;
  onOpenSettings: () => void;
}) {
  const { data, loading, error, reload } = useApi<PayrollResponse>(
    `/api/admin/drivers/payroll?from=${period.from}&to=${period.to}`
  );

  const [expanded, setExpanded] = useState<string | null>(null);
  const [bonusFor, setBonusFor] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({ day: period.to, amount: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function saveBonus() {
    if (!bonusFor) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/drivers/bonuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driverId: bonusFor.id,
          day: form.day,
          amount: Number(form.amount),
          reason: form.reason,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти");
      setBonusFor(null);
      setForm({ day: period.to, amount: "", reason: "" });
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Помилка збереження");
    } finally {
      setBusy(false);
    }
  }

  async function deleteBonus(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/drivers/bonuses?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося видалити");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Помилка видалення");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <TableSkeleton rows={5} cols={7} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Маршрутних листів" value={num(data.totals.sheetsCount)} accent={CATEGORICAL[1]} />
        <StatCard label="Пробіг" value={num(data.totals.totalKm)} unit="км" accent={CATEGORICAL[2]} />
        <StatCard label="Надбавки" value={money(data.totals.bonusesTotal)} unit="грн" hint="вручну" />
        <StatCard label="До виплати" value={money(data.totals.total)} unit="грн" accent={CATEGORICAL[0]} />
      </div>

      {data.unmappedSheets > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-900">
            {data.unmappedSheets} маршрутних листів без прив&apos;язаного акаунта водія — зарплата за них
            не нарахована.
          </p>
          <button
            type="button"
            onClick={onOpenSettings}
            className="cursor-pointer rounded-[var(--radius-btn)] border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
          >
            Прив&apos;язати водіїв
          </button>
        </div>
      )}

      {message && <ErrorBox message={message} />}

      {data.rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Немає нарахувань за період"
            hint="Маршрутні листи підтягуються з 1С. Якщо їх немає — перевірте синхронізацію або період."
          />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Нарахування водіям"
              hint={`Ставка за пробіг на кожен лист + точки (місто ${data.rates.cityPointRate} ₴, область ${data.rates.oblastPointRate} ₴) + ${data.rates.turnoverPercent}% від суми в листі за мінусом зібраних боргів.`}
            />
          </div>

          <TableScroll stickyHeader minWidth={900}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Водій</th>
                  <th className="px-4 py-2.5 text-right">Листів</th>
                  <th className="px-4 py-2.5 text-right">Пробіг</th>
                  <th className="px-4 py-2.5 text-right">Точки</th>
                  <th className="px-4 py-2.5 text-right">База %</th>
                  <th className="px-4 py-2.5 text-right">За листи</th>
                  <th className="px-4 py-2.5 text-right">Надбавки</th>
                  <th className="px-4 py-2.5 text-right">Разом</th>
                  {data.canEdit && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {data.rows.map((r) => (
                  <>
                    <tr
                      key={r.driverId}
                      className="cursor-pointer hover:bg-g50"
                      onClick={() => setExpanded(expanded === r.driverId ? null : r.driverId)}
                    >
                      <td className="px-4 py-3 font-medium text-bk">
                        <span className="mr-1.5 inline-block text-g400">
                          {expanded === r.driverId ? "▾" : "▸"}
                        </span>
                        {r.driverName}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">{r.sheetsCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">{num(r.totalKm)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">
                        {r.cityPoints + r.oblastPoints}
                        <span className="ml-1 text-xs text-g400">
                          ({r.cityPoints} м / {r.oblastPoints} о)
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">{money(r.turnoverBase)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">{money(r.sheetsTotal)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-g600">
                        {r.bonusesTotal !== 0 ? money(r.bonusesTotal) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                        {money(r.total)}
                      </td>
                      {data.canEdit && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setBonusFor({ id: r.driverId, name: r.driverName });
                              setForm({ day: period.to, amount: "", reason: "" });
                            }}
                            className="cursor-pointer rounded-[var(--radius-badge)] border border-g200 px-2.5 py-1 text-xs text-g600 transition-colors hover:border-g300 hover:text-bk"
                          >
                            + Надбавка
                          </button>
                        </td>
                      )}
                    </tr>

                    {expanded === r.driverId && (
                      <tr key={`${r.driverId}-detail`}>
                        <td colSpan={data.canEdit ? 9 : 8} className="bg-g50 px-4 py-3">
                          <div className="space-y-3">
                            {r.sheets.map((s) => (
                              <div
                                key={s.routeSheetId}
                                className="rounded-[var(--radius-card)] border border-g200 bg-white p-3"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="text-sm font-medium text-bk">
                                    {s.number}
                                    <span className="ml-2 text-xs font-normal text-g500">{s.day}</span>
                                    <span className="ml-2 text-xs font-normal text-g400">
                                      {s.kmSource === "PLAN" && (
                                        <span title="Плановий пробіг OSRM — факт вводиться у вкладці «Листи»">≈ </span>
                                      )}
                                      {num(s.distanceKm)} км · {s.cityPoints + s.oblastPoints} точок
                                    </span>
                                    {s.source === "SHEET_1C" && (
                                      <span className="ml-2 inline-block align-middle">
                                        <Badge status="neutral">1С</Badge>
                                      </span>
                                    )}
                                    {s.unknownZonePoints > 0 && (
                                      <span className="ml-2 inline-block align-middle">
                                        <Badge status="warn">
                                          {s.unknownZonePoints} без зони
                                        </Badge>
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-sm font-semibold tabular-nums text-bk">
                                    {money(s.total)}
                                  </div>
                                </div>
                                <ul className="mt-2 space-y-1">
                                  {s.lines.map((l, i) => (
                                    <li
                                      key={`${s.routeSheetId}-${l.kind}-${i}`}
                                      className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                                    >
                                      <span className="text-g600">{l.explanation}</span>
                                      <span className="tabular-nums font-medium text-g700">
                                        {money(l.amount)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}

                            {r.bonuses.length > 0 && (
                              <div className="rounded-[var(--radius-card)] border border-g200 bg-white p-3">
                                <p className="mb-2 text-xs font-medium text-g500">Ручні надбавки</p>
                                <ul className="space-y-1.5">
                                  {r.bonuses.map((b) => (
                                    <li
                                      key={b.id}
                                      className="flex flex-wrap items-baseline justify-between gap-2 text-xs"
                                    >
                                      <span className="text-g600">
                                        {b.day} — {b.reason}
                                        {b.createdByName && (
                                          <span className="ml-1.5 text-g400">({b.createdByName})</span>
                                        )}
                                      </span>
                                      <span className="flex items-center gap-2">
                                        <span
                                          className={`tabular-nums font-medium ${b.amount < 0 ? "text-red-600" : "text-g700"}`}
                                        >
                                          {money(b.amount)}
                                        </span>
                                        {data.canEdit && (
                                          <button
                                            type="button"
                                            onClick={() => deleteBonus(b.id)}
                                            disabled={busy}
                                            aria-label="Видалити надбавку"
                                            className="cursor-pointer text-g400 transition-colors hover:text-red-600 disabled:opacity-50"
                                          >
                                            ✕
                                          </button>
                                        )}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {r.sheets.length === 0 && r.bonuses.length === 0 && (
                              <p className="text-xs text-g500">Немає деталізації за період.</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      {bonusFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-[var(--radius-card)] bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-bk">Надбавка: {bonusFor.name}</h3>
            <p className="mt-1 text-xs text-g500">
              Для того, чого немає в маршрутному листі: доставка Новою поштою, підміна. Від&apos;ємна
              сума — утримання.
            </p>

            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-g600">Дата</span>
                <input
                  type="date"
                  value={form.day}
                  onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))}
                  className="mt-1 w-full rounded-[var(--radius-badge)] border border-g200 px-2.5 py-1.5 text-sm text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-g600">Сума, ₴</span>
                <input
                  type="number"
                  step={10}
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="200"
                  className="mt-1 w-full rounded-[var(--radius-badge)] border border-g200 px-2.5 py-1.5 text-sm tabular-nums text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-g600">Причина</span>
                <input
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="Доставка Новою поштою, 3 відправлення"
                  className="mt-1 w-full rounded-[var(--radius-badge)] border border-g200 px-2.5 py-1.5 text-sm text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBonusFor(null)}
                className="cursor-pointer rounded-[var(--radius-btn)] border border-g200 px-3.5 py-2 text-sm text-g600 transition-colors hover:border-g300"
              >
                Скасувати
              </button>
              <button
                type="button"
                onClick={saveBonus}
                disabled={busy}
                className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-3.5 py-2 text-sm font-semibold text-bk transition-colors hover:bg-primary-hover disabled:opacity-60"
              >
                Додати
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
