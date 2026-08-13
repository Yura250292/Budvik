"use client";

import { useState } from "react";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { money, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";

/**
 * Журнал маршрутних листів: маршрути планувальника сайту + листи 1С.
 *
 * Головне джерело — маршрут сайту (у 1С лист — лише шапка без точок).
 * Для нього адмін вводить фактичний пробіг: у 1С кілометражу немає, тому
 * поки поле порожнє, розрахунок бере планові км OSRM і показує «≈».
 *
 * На відміну від вкладки зарплати, тут видно й листи без прив'язаного
 * водія — тобто те, що прийшло з обміну, але ще нікому не нараховано.
 *
 * Деталь листа показує кожну точку із зоною і дозволяє її перемкнути:
 * автовизначення (полігон об'їзної) помиляється там, де немає координат,
 * і без ручної правки водій втрачав би по 10 ₴ на точці.
 */

type Stop = {
  id: string;
  sequence: number;
  counterpartyId: string | null;
  counterpartyName: string | null;
  address: string | null;
  amount: number;
  debtAmount: number;
  zone: "CITY" | "OBLAST";
  zoneSource: "OVERRIDE" | "POLYGON" | "ADDRESS" | "UNKNOWN";
  paid: boolean;
};

type SheetsResponse = {
  period: { from: string; to: string; days: number };
  canEdit: boolean;
  rates: { cityPointRate: number; oblastPointRate: number };
  rows: Array<{
    id: string;
    source: "SITE" | "SHEET_1C";
    number: string;
    day: string;
    posted: boolean;
    driverId: string | null;
    driverName: string | null;
    driverName1C: string | null;
    vehicle: string | null;
    distanceKm: number;
    plannedKm: number | null;
    actualKm: number | null;
    ordersTotal: number;
    debtsTotal: number;
    stopsCount: number;
    paidPoints: number;
    unknownZonePoints: number;
    total: number;
    lines: Array<{ kind: string; label: string; amount: number; explanation: string }>;
    stops: Stop[];
  }>;
};

const ZONE_SOURCE_LABEL: Record<Stop["zoneSource"], string> = {
  OVERRIDE: "вручну",
  POLYGON: "за координатами",
  ADDRESS: "за адресою",
  UNKNOWN: "не визначено",
};

/**
 * Поле фактичного пробігу маршруту сайту.
 *
 * Окремий компонент, щоб чернетка вводу жила локально й скидалася при
 * перемиканні рядка (key={id} у місці виклику). Порожнє значення повертає
 * розрахунок до планових км OSRM.
 */
function ActualKmEditor({
  routeId,
  actualKm,
  plannedKm,
  onSaved,
  onError,
}: {
  routeId: string;
  actualKm: number | null;
  plannedKm: number | null;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState(actualKm != null ? String(actualKm) : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = draft.trim().replace(",", ".");
    const value = trimmed === "" ? null : Number(trimmed);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      onError("Пробіг має бути числом ≥ 0");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/drivers/route-sheets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeId, actualKm: value }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти пробіг");
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Помилка збереження");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium text-g500">Фактичний пробіг:</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={saving}
        placeholder={plannedKm != null ? `≈ ${Math.round(plannedKm)}` : "км"}
        aria-label="Фактичний пробіг, км"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
        }}
        className="w-24 rounded-[var(--radius-badge)] border border-g200 px-2 py-1 text-right tabular-nums text-g700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
      />
      <span className="text-g500">км</span>
      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="cursor-pointer rounded-[var(--radius-badge)] border border-g200 px-2 py-1 font-medium text-g600 hover:bg-g50 disabled:opacity-50"
      >
        {saving ? "Зберігаю…" : "Зберегти"}
      </button>
      <span className="text-g400">
        {plannedKm != null ? `план OSRM ≈ ${Math.round(plannedKm)} км · ` : ""}
        порожнє поле — рахуємо за планом
      </span>
    </div>
  );
}

export function SheetsTab({ period }: { period: Period }) {
  const { data, loading, error, reload } = useApi<SheetsResponse>(
    `/api/admin/drivers/route-sheets?from=${period.from}&to=${period.to}`
  );
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function setZone(counterpartyId: string, zone: "CITY" | "OBLAST" | null) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/drivers/zone", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counterpartyId, zone }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти зону");
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Помилка збереження");
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <TableSkeleton rows={6} cols={7} />;
  if (!data) return null;

  if (data.rows.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Немає маршрутів за період"
          hint="Маршрути формуються в планувальнику доставки; листи 1С — запасне джерело для днів без маршруту сайту."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {message && <ErrorBox message={message} />}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Маршрутні листи"
            hint="Головне джерело — маршрути сайту; «1С» — запасні листи з обміну. Точки з однаковою адресою оплачуються як одна. Пробіг «≈» — плановий, поки адмін не ввів фактичний у деталі."
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                <th className="px-4 py-2.5">Лист</th>
                <th className="px-4 py-2.5">Водій</th>
                <th className="px-4 py-2.5 text-right">Пробіг</th>
                <th className="px-4 py-2.5 text-right">Точки</th>
                <th className="px-4 py-2.5 text-right">Замовлення</th>
                <th className="px-4 py-2.5 text-right">Борги</th>
                <th className="px-4 py-2.5 text-right">Нараховано</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-g100">
              {data.rows.map((r) => (
                <>
                  <tr
                    key={r.id}
                    className="cursor-pointer hover:bg-g50"
                    onClick={() => setOpen(open === r.id ? null : r.id)}
                  >
                    <td className="px-4 py-3 font-medium text-bk">
                      <span className="mr-1.5 inline-block text-g400">{open === r.id ? "▾" : "▸"}</span>
                      {r.number}
                      <span className="ml-2 text-xs font-normal text-g500">{r.day}</span>
                      {r.source === "SHEET_1C" && (
                        <span className="ml-2 inline-block align-middle">
                          <Badge status="neutral">1С</Badge>
                        </span>
                      )}
                      {!r.posted && (
                        <span className="ml-2 inline-block align-middle">
                          <Badge status="warn">не проведено</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-g600">
                      {r.driverName ?? (
                        <span className="text-amber-700">
                          {r.driverName1C ?? "—"}
                          <span className="ml-1.5 inline-block align-middle">
                            <Badge status="warn">не прив&apos;язано</Badge>
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">
                      {r.source === "SITE" && r.actualKm == null && r.distanceKm > 0 && (
                        <span className="mr-0.5 text-g400" title="Плановий пробіг OSRM — факт ще не введено">
                          ≈
                        </span>
                      )}
                      {num(r.distanceKm)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">
                      {r.paidPoints}
                      {r.stopsCount !== r.paidPoints && (
                        <span className="ml-1 text-xs text-g400">з {r.stopsCount}</span>
                      )}
                      {r.unknownZonePoints > 0 && (
                        <span className="ml-1.5 inline-block align-middle">
                          <Badge status="warn">{r.unknownZonePoints} без зони</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{money(r.ordersTotal)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{money(r.debtsTotal)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-bk">
                      {money(r.total)}
                    </td>
                  </tr>

                  {open === r.id && (
                    <tr key={`${r.id}-detail`}>
                      <td colSpan={7} className="bg-g50 px-4 py-3">
                        <div className="space-y-3">
                          {r.source === "SITE" && data.canEdit && (
                            <div className="rounded-[var(--radius-card)] border border-g200 bg-white p-3">
                              <ActualKmEditor
                                key={r.id}
                                routeId={r.id}
                                actualKm={r.actualKm}
                                plannedKm={r.plannedKm}
                                onSaved={reload}
                                onError={setMessage}
                              />
                            </div>
                          )}

                          <div className="rounded-[var(--radius-card)] border border-g200 bg-white p-3">
                            <p className="mb-2 text-xs font-medium text-g500">
                              Точки вигрузки{r.vehicle ? ` · ${r.vehicle}` : ""}
                            </p>
                            {r.stops.length === 0 ? (
                              <p className="text-xs text-g500">
                                У листі немає рядків — точки не нараховані.
                              </p>
                            ) : (
                              <ul className="space-y-1.5">
                                {r.stops.map((s) => (
                                  <li
                                    key={s.id}
                                    className={`flex flex-wrap items-center justify-between gap-2 text-xs ${s.paid ? "" : "opacity-60"}`}
                                  >
                                    <span className="min-w-0 text-g600">
                                      <span className="mr-1.5 text-g400">{s.sequence || "·"}</span>
                                      {s.counterpartyName ?? "—"}
                                      {s.address && <span className="ml-1.5 text-g400">{s.address}</span>}
                                      {!s.paid && (
                                        <span className="ml-1.5 text-g400">(дубль адреси, не оплачується)</span>
                                      )}
                                    </span>
                                    <span className="flex flex-shrink-0 items-center gap-2">
                                      <span className="text-g500">
                                        {s.zone === "CITY" ? "місто" : "область"}
                                        <span className="ml-1 text-g400">
                                          ({ZONE_SOURCE_LABEL[s.zoneSource]})
                                        </span>
                                      </span>
                                      {data.canEdit && s.counterpartyId && (
                                        <select
                                          value={s.zoneSource === "OVERRIDE" ? s.zone : ""}
                                          disabled={busy}
                                          aria-label={`Зона для ${s.counterpartyName ?? "точки"}`}
                                          onChange={(e) =>
                                            setZone(
                                              s.counterpartyId!,
                                              e.target.value === "" ? null : (e.target.value as "CITY" | "OBLAST")
                                            )
                                          }
                                          className="cursor-pointer rounded-[var(--radius-badge)] border border-g200 px-1.5 py-0.5 text-xs text-g600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
                                        >
                                          <option value="">Авто</option>
                                          <option value="CITY">Місто</option>
                                          <option value="OBLAST">Область</option>
                                        </select>
                                      )}
                                      <span className="w-20 text-right tabular-nums text-g600">
                                        {money(s.amount)}
                                      </span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          {r.lines.length > 0 && (
                            <div className="rounded-[var(--radius-card)] border border-g200 bg-white p-3">
                              <p className="mb-2 text-xs font-medium text-g500">Розрахунок</p>
                              <ul className="space-y-1">
                                {r.lines.map((l, i) => (
                                  <li
                                    key={`${r.id}-${l.kind}-${i}`}
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
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
