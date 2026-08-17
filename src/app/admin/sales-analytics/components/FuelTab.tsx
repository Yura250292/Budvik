"use client";

import { useState } from "react";
import type { Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { StatCard, money, num } from "@/components/ui/Stat";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { Badge } from "@/components/ui/Badge";
import { CATEGORICAL } from "@/lib/analytics/colors";
import { TableScroll } from "@/components/ui/TableScroll";

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
  baseRadiusM: number;
  rows: Array<{
    repId: string;
    repName: string;
    label: string | null;
    hasVehicle: boolean;
    baseAddress: string | null;
    /** Адреса геокодувалася успішно — без цього подача не рахується */
    hasBase: boolean;
    /** Звідки торговий справді виїжджає, за треком планшета */
    learnedBase: {
      lat: number;
      lng: number;
      mornings: number;
      daysSeen: number;
      spreadM: number;
      /** Наскільки GPS розходиться зі збереженою базою, метри */
      movedM: number | null;
    } | null;
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
  const [form, setForm] = useState({
    label: "",
    fuelConsumption: "",
    fuelPricePerL: "",
    baseAddress: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Ручний вибір координат.
   *
   * Частини наших адрес в OSM немає взагалі — «Львів, вул. Незимна» не знайде
   * жоден геокодер. Тоді єдиний шлях — дати людині знайти найближчу відому
   * точку (сусідню вулицю, площу, орієнтир) і взяти її координати.
   */
  const [picker, setPicker] = useState<{ repId: string; query: string } | null>(null);
  const [candidates, setCandidates] = useState<
    Array<{ lat: number; lng: number; displayName: string }>
  >([]);
  const [searching, setSearching] = useState(false);

  async function saveVehicle(repId: string, coords?: { lat: number; lng: number }) {
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
          baseAddress: form.baseAddress || null,
          ...(coords ? { baseLat: coords.lat, baseLng: coords.lng } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти");
      setEditing(null);
      setPicker(null);
      setCandidates([]);
      // Адреса збереглася, але Nominatim її не знайшов. Мовчати не можна:
      // подача не рахуватиметься, а план тихо лишиться заниженим.
      if (json.baseNotFound) {
        setMessage(
          "Збережено, але адресу бази не знайдено на карті — подача не рахуватиметься. " +
            "Натисніть «Знайти на карті» і виберіть найближчу відому точку."
        );
        setPicker({ repId, query: form.baseAddress });
      } else {
        setMessage(null);
      }
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Помилка збереження");
    } finally {
      setBusy(false);
    }
  }

  /** Взяти базу з GPS: сервер сам візьме точку з треку й підпише адресою. */
  async function acceptLearnedBase(repId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/sales-vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося взяти базу з GPS");
      setPicker(null);
      setCandidates([]);
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Помилка");
    } finally {
      setBusy(false);
    }
  }

  async function searchCandidates(query: string) {
    if (query.trim().length < 3) return;
    setSearching(true);
    setCandidates([]);
    try {
      const res = await fetch(`/api/geo/geocode?all=1&q=${encodeURIComponent(query)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Пошук не вдався");
      setCandidates(json.items ?? []);
      if ((json.items ?? []).length === 0) {
        setMessage("За цим запитом нічого не знайдено. Спробуйте сусідню вулицю або орієнтир.");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Помилка пошуку");
    } finally {
      setSearching(false);
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
        <StatCard label="Робочі км" value={num(data.totals.workKm)} unit="км" hint="без особистих" accent={CATEGORICAL[1]} />
        <StatCard label="Пальне" value={num(data.totals.liters)} unit="л" accent={CATEGORICAL[2]} />
        <StatCard label="Вартість" value={money(data.totals.cost)} unit="грн" accent={CATEGORICAL[0]} />
        <StatCard
          label="У середньому"
          value={money(data.totals.workKm > 0 ? data.totals.cost / data.totals.workKm : 0)}
          unit="грн/км"
        />
      </div>

      {message && <ErrorBox message={message} />}

      {/* Ручний вибір точки: остання надія для адреси, якої в OSM немає */}
      {picker && (
        <Card>
          <CardHeader
            title="Знайти базу на карті"
            hint="Геокодер не знає цієї адреси. Знайдіть найближчу відому точку — сусідню вулицю, площу, орієнтир — і виберіть її. Для подачі важливі кілометри, а не точний дім."
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={picker.query}
              onChange={(e) => setPicker((p) => (p ? { ...p, query: e.target.value } : p))}
              onKeyDown={(e) => {
                if (e.key === "Enter") searchCandidates(picker.query);
              }}
              placeholder="Львів, Наукова"
              aria-label="Пошук точки на карті"
              className="min-w-[240px] flex-1 rounded-[var(--radius-badge)] border border-g200 px-3 py-2 text-sm text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
            />
            <button
              type="button"
              onClick={() => searchCandidates(picker.query)}
              disabled={searching || picker.query.trim().length < 3}
              className="cursor-pointer rounded-[var(--radius-badge)] bg-primary px-3 py-2 text-sm font-semibold text-bk transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {searching ? "Шукаю…" : "Шукати"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPicker(null);
                setCandidates([]);
              }}
              className="cursor-pointer rounded-[var(--radius-badge)] border border-g200 px-3 py-2 text-sm text-g600 transition-colors hover:border-g300"
            >
              Закрити
            </button>
          </div>

          {candidates.length > 0 && (
            <ul className="mt-3 divide-y divide-g100 rounded-[var(--radius-badge)] border border-g200">
              {candidates.map((c) => (
                <li key={`${c.lat},${c.lng}`}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveVehicle(picker.repId, { lat: c.lat, lng: c.lng })}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-g600 transition-colors hover:bg-g50 disabled:opacity-60"
                  >
                    <span>{c.displayName}</span>
                    <span className="shrink-0 text-xs tabular-nums text-g400">
                      {c.lat.toFixed(4)}, {c.lng.toFixed(4)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Авто та витрати на пальне"
            hint={`Формула: робочі км ÷ 100 × норма × ціна. Без авто застосовується ${data.defaults.fuelConsumption} л/100км і ${data.defaults.fuelPricePerL} грн/л. База — звідки торговий виїжджає вранці: без неї «План» у Логістиці не враховує дорогу до маршруту й назад. Адресу можна не вводити руками: планшет сам показує місце старту з точністю до ${data.baseRadiusM} м, коли кілька ранків збігаються.`}
          />
        </div>

        <TableScroll stickyHeader minWidth={1040}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                <th className="px-4 py-2.5">Торговий</th>
                <th className="px-4 py-2.5">Авто</th>
                <th className="px-4 py-2.5">База (звідки виїжджає)</th>
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
                        <td className="px-4 py-2">
                          <input
                            value={form.baseAddress}
                            onChange={(e) => setForm((f) => ({ ...f, baseAddress: e.target.value }))}
                            placeholder="Стрий, вул. Шевченка 1"
                            aria-label="Адреса бази: звідки торговий виїжджає"
                            className="w-52 rounded-[var(--radius-badge)] border border-g200 px-2 py-1 text-xs text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
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
                        <td className="px-4 py-3 text-g600">
                          {r.baseAddress ? (
                            <>
                              <span className="text-xs">{r.baseAddress}</span>
                              {/* Адреса є, а координат немає: геокодер промахнувся,
                                  і подача мовчки не рахується — треба показати. */}
                              {!r.hasBase && (
                                <span className="ml-1.5 inline-flex items-center gap-1.5 align-middle">
                                  <Badge status="warn">не знайдено</Badge>
                                  {data.canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMessage(null);
                                        setCandidates([]);
                                        setPicker({ repId: r.repId, query: r.baseAddress ?? "" });
                                        setForm((f) => ({
                                          ...f,
                                          label: r.label ?? "",
                                          fuelConsumption: String(r.fuelConsumption),
                                          fuelPricePerL: String(r.fuelPricePerL),
                                          baseAddress: r.baseAddress ?? "",
                                        }));
                                      }}
                                      className="cursor-pointer rounded-[var(--radius-badge)] border border-g200 px-2 py-0.5 text-xs text-g600 transition-colors hover:border-g300 hover:text-bk"
                                    >
                                      Знайти на карті
                                    </button>
                                  )}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-g400">не вказано</span>
                          )}

                          {/* Що показав GPS. Пропонуємо, коли бази немає або
                              вона не знайшлася; попереджаємо, коли збережена
                              база розійшлася з тим, звідки людина виїжджає. */}
                          {r.learnedBase && data.canEdit && (() => {
                            const lb = r.learnedBase;
                            const needsBase = !r.hasBase;
                            const moved = lb.movedM != null && lb.movedM > data.baseRadiusM;
                            if (!needsBase && !moved) return null;

                            return (
                              <div className="mt-1.5 text-xs">
                                <span className="text-g500">
                                  GPS: старт з одного місця {lb.mornings} з {lb.daysSeen} ранків
                                  {lb.spreadM > 0 && ` (розкид ${lb.spreadM} м)`}
                                  {moved && `, за ${num(lb.movedM ?? 0)} м від указаної`}
                                </span>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => acceptLearnedBase(r.repId)}
                                  className="ml-1.5 cursor-pointer rounded-[var(--radius-badge)] border border-g200 px-2 py-0.5 text-xs text-g600 transition-colors hover:border-g300 hover:text-bk disabled:opacity-60"
                                >
                                  {moved ? "Оновити з GPS" : "Взяти з GPS"}
                                </button>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-g600">
                          {num(r.fuelConsumption, 1)}
                          <span className="ml-1 text-xs text-g400">л</span>
                          {!r.hasVehicle && (
                            <span className="ml-1.5 inline-block align-middle">
                              <Badge status="warn">за замовч.</Badge>
                            </span>
                          )}
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
                                baseAddress: r.baseAddress ?? "",
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
        </TableScroll>
      </Card>
    </div>
  );
}
