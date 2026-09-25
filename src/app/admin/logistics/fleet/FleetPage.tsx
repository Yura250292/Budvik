"use client";

/**
 * «Автопарк»: машини, кілометраж за період, заміни масла й деталей, ТО,
 * амортизація.
 *
 * Машина — окрема сутність, а не налаштування людини (як SalesVehicle у
 * «Паливі»): пересадили торгового — журнал лишився з машиною. Період (?from=
 * &to=) спільний з рештою «Логістики», вибрана машина — у ?v=, щоб посилання
 * з помічника відкривало одразу її.
 *
 * Відмітка «авто фірми / авто торгового» — лише облікова: амортизація й ТО
 * рахуються однаково, бо власна машина торгового так само зношується на
 * роботі фірми.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodPicker, type Period } from "@/components/ui/PeriodPicker";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { StatCard, money, num } from "@/components/ui/Stat";
import { useApi } from "@/components/ui/useApi";
import { DUE_LABEL } from "@/lib/fleet/due";
import { OWNERSHIP_LABEL } from "@/lib/fleet/title";
import { periodFromParams, replaceQuery } from "../components/url-state";
import { ImportFromFuel } from "./ImportFromFuel";
import { VehicleDetail } from "./VehicleDetail";
import { VehicleForm } from "./VehicleForm";
import { BTN_GHOST, BTN_PRIMARY, DUE_STATUS, ddmmyyyy, dueText, type ListResponse } from "./ui";

type OwnerFilter = "" | "COMPANY" | "PERSONAL";

export function FleetPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [period, setPeriod] = useState<Period>(() => periodFromParams(params));
  const [selected, setSelected] = useState<string | null>(() => params.get("v"));
  const [owner, setOwner] = useState<OwnerFilter>(() => (params.get("own") as OwnerFilter) ?? "");
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useApi<ListResponse>(
    `/api/admin/fleet/vehicles?from=${period.from}&to=${period.to}${showAll ? "&all=1" : ""}`
  );

  useEffect(() => {
    replaceQuery(router, "/admin/logistics/fleet", { from: period.from, to: period.to, v: selected, own: owner || null });
  }, [period, selected, owner, router]);

  const header = <PeriodPicker value={period} onChange={setPeriod} />;
  if (error) return <div className="space-y-4">{header}<ErrorBox message={error} onRetry={reload} /></div>;
  if (loading && !data) return <div className="space-y-4">{header}<TableSkeleton rows={4} cols={6} /></div>;
  if (!data) return null;

  const t = data.totals;
  const list = owner ? data.vehicles.filter((v) => v.ownership === owner) : data.vehicles;
  const company = data.vehicles.filter((v) => v.active && v.ownership === "COMPANY").length;
  const personal = data.vehicles.filter((v) => v.active && v.ownership === "PERSONAL").length;
  const listKm = list.reduce((s, v) => s + v.periodKm.totalKm, 0);

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Машин в обліку" value={t.vehicles} hint={`фірми ${company} · торгових ${personal}`} />
        <StatCard
          label="Пробіг за період"
          value={num(t.periodKm)}
          unit="км"
          hint={`пальне ≈ ${money(t.fuelCost)} ₴`}
        />
        <StatCard
          label="ТО прострочено / скоро"
          value={`${t.overdue} / ${t.soon}`}
          tone={t.overdue ? "bad" : t.soon ? "warn" : "default"}
        />
        <StatCard label="Обслуговування за період" value={money(t.periodCost)} unit="₴" />
        <StatCard label="Амортизація на місяць" value={money(t.monthlyDepreciation)} unit="₴" hint="Лише машини з ціною й строком" />
      </div>

      <ImportFromFuel onDone={reload} />

      {adding && (
        <Card>
          <CardHeader title="Нова машина" />
          <VehicleForm
            vehicle={null}
            onSaved={(id) => {
              setAdding(false);
              reload();
              setSelected(id);
            }}
            onCancel={() => setAdding(false)}
          />
        </Card>
      )}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Машини"
            hint="Пробіг за період — зміни тих, хто на машині їздив (робочі з одометра + особисті між змінами), як у «Паливі»"
            action={
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                <button type="button" className={BTN_GHOST} onClick={() => setShowAll((s) => !s)}>
                  {showAll ? "Лише в обліку" : "Показати зняті"}
                </button>
                {!adding && (
                  <button type="button" className={BTN_PRIMARY} onClick={() => setAdding(true)}>
                    + Машина
                  </button>
                )}
              </div>
            }
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Чиї машини">
            {(
              [
                ["", "Усі"],
                ["COMPANY", "Авто фірми"],
                ["PERSONAL", "Авто торгових"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={owner === key}
                onClick={() => setOwner(key)}
                className={`cursor-pointer rounded-[var(--radius-badge)] border px-2.5 py-1 text-xs transition-colors ${
                  owner === key ? "border-bk bg-bk text-white" : "border-g200 text-g600 hover:border-g300 hover:text-bk"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {list.length === 0 ? (
          <EmptyState
            title={data.vehicles.length ? "За цим фільтром машин немає" : "Машин ще немає"}
            hint={
              data.vehicles.length
                ? undefined
                : "Перенесіть машини з «Палива» кнопкою вище або додайте вручну."
            }
          />
        ) : (
          <TableScroll minWidth={920}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs text-g500">
                  <th className="px-4 py-2 font-medium">Машина</th>
                  <th className="px-4 py-2 font-medium">Хто їздить</th>
                  <th className="px-4 py-2 text-right font-medium">Пробіг за період</th>
                  <th className="px-4 py-2 text-right font-medium">Одометр</th>
                  <th className="px-4 py-2 font-medium">Найближче ТО</th>
                  <th className="px-4 py-2 text-right font-medium">Обслуговування</th>
                  <th className="px-4 py-2 text-right font-medium">Залишкова вартість</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {list.map((v) => {
                  const next = v.worstDue ?? v.due[0] ?? null;
                  const km = v.periodKm;
                  return (
                    <tr
                      key={v.id}
                      onClick={() => setSelected(v.id === selected ? null : v.id)}
                      className={`cursor-pointer hover:bg-g50 ${v.id === selected ? "bg-g50" : ""} ${v.active ? "" : "opacity-60"}`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-bk">{v.plate ?? <span className="text-g400">без номера</span>}</span>
                        <span className="block text-xs text-g500">
                          {v.make} {v.model}
                          {v.year ? `, ${v.year}` : ""}
                        </span>
                        <span className="mt-1 inline-block">
                          <Badge status={v.ownership === "COMPANY" ? "info" : "neutral"}>{OWNERSHIP_LABEL[v.ownership]}</Badge>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-g600">{v.holder?.name ?? <span className="text-g400">—</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {km.totalKm > 0 || km.shifts > 0 ? (
                          <>
                            <span className="font-medium text-bk">{num(km.totalKm)} км</span>
                            <span className="block text-[11px] text-g400">
                              роб. {num(km.workKm)} · особ. {num(km.personalKm)} · {km.shifts} зм.
                            </span>
                            {km.openShifts > 0 && (
                              <span className="block text-[11px] text-g400">{km.openShifts} зміна відкрита</span>
                            )}
                          </>
                        ) : (
                          <span className="text-g400">змін немає</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                        {v.odometer ? (
                          <>
                            <span className="text-bk">{num(v.odometer.km)} км</span>
                            <span className="block text-[11px] text-g400">{ddmmyyyy(v.odometer.day)}</span>
                          </>
                        ) : (
                          <span className="text-g400">невідомо</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {next ? (
                          <>
                            <Badge status={DUE_STATUS[next.state]} dot>
                              {next.kindLabel}: {DUE_LABEL[next.state]}
                            </Badge>
                            <span className="block text-xs text-g500">{dueText(next)}</span>
                          </>
                        ) : (
                          <span className="text-xs text-g400">правил не задано</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-bk">
                        {money(v.periodCost)} ₴
                        {v.periodServices > 0 && (
                          <span className="block text-[11px] text-g400">{v.periodServices} зап.</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-bk">
                        {v.depreciation ? `${money(v.depreciation.bookValue)} ₴` : <span className="text-g400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {list.length > 1 && (
                <tfoot>
                  <tr className="border-t border-g200 text-xs text-g600">
                    <td className="px-4 py-2 font-medium" colSpan={2}>
                      Разом {list.length} маш.
                    </td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-bk">{num(listKm)} км</td>
                    <td colSpan={2} />
                    <td className="px-4 py-2 text-right tabular-nums text-bk">
                      {money(list.reduce((s, v) => s + v.periodCost, 0))} ₴
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </TableScroll>
        )}
      </Card>

      {selected && (
        <VehicleDetail
          key={selected}
          id={selected}
          period={period}
          people={data.people}
          onChanged={reload}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
