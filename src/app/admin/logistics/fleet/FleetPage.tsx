"use client";

/**
 * «Автопарк»: машини фірми, заміни масла й деталей, ТО, амортизація.
 *
 * Машина — окрема сутність, а не налаштування людини (як SalesVehicle у
 * «Паливі»): пересадили торгового — журнал лишився з машиною. Вибрана
 * машина живе в ?v=, щоб посилання з помічника відкривало одразу її.
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { StatCard, money, num } from "@/components/ui/Stat";
import { useApi } from "@/components/ui/useApi";
import { DUE_LABEL } from "@/lib/fleet/due";
import { VehicleDetail } from "./VehicleDetail";
import { VehicleForm } from "./VehicleForm";
import { BTN_GHOST, BTN_PRIMARY, DUE_STATUS, ddmmyyyy, dueText, type ListResponse } from "./ui";

export function FleetPage() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("v");
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const { data, loading, error, reload } = useApi<ListResponse>(`/api/admin/fleet/vehicles${showAll ? "?all=1" : ""}`);

  const select = (id: string | null) => {
    const q = new URLSearchParams(params.toString());
    if (id) q.set("v", id);
    else q.delete("v");
    router.replace(`/admin/logistics/fleet${q.size ? `?${q}` : ""}`, { scroll: false });
  };

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <TableSkeleton rows={4} cols={6} />;
  if (!data) return null;

  const t = data.totals;
  const year = data.today.slice(0, 4);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Машин в обліку" value={t.vehicles} />
        <StatCard
          label="ТО прострочено / скоро"
          value={`${t.overdue} / ${t.soon}`}
          tone={t.overdue ? "bad" : t.soon ? "warn" : "default"}
        />
        <StatCard label={`Обслуговування за ${year}`} value={money(t.periodCost)} unit="₴" />
        <StatCard label="Амортизація на місяць" value={money(t.monthlyDepreciation)} unit="₴" hint="Лише машини з ціною й строком" />
      </div>

      {adding && (
        <Card>
          <CardHeader title="Нова машина" />
          <VehicleForm
            vehicle={null}
            onSaved={(id) => {
              setAdding(false);
              reload();
              select(id);
            }}
            onCancel={() => setAdding(false)}
          />
        </Card>
      )}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Машини"
            hint="Пробіг — найсвіжіше з ручного показання, журналу й змін того, хто їздить"
            action={
              <div className="flex shrink-0 gap-2">
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
        </div>
        {data.vehicles.length === 0 ? (
          <EmptyState
            title="Машин ще немає"
            hint="Додайте машину, закріпіть за торговим чи водієм і внесіть останню заміну масла."
          />
        ) : (
          <TableScroll minWidth={820}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs text-g500">
                  <th className="px-4 py-2 font-medium">Машина</th>
                  <th className="px-4 py-2 font-medium">Хто їздить</th>
                  <th className="px-4 py-2 text-right font-medium">Пробіг</th>
                  <th className="px-4 py-2 font-medium">Найближче ТО</th>
                  <th className="px-4 py-2 text-right font-medium">Обслуговування {year}</th>
                  <th className="px-4 py-2 text-right font-medium">Залишкова вартість</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {data.vehicles.map((v) => {
                  const next = v.worstDue ?? v.due[0] ?? null;
                  return (
                    <tr
                      key={v.id}
                      onClick={() => select(v.id === selected ? null : v.id)}
                      className={`cursor-pointer hover:bg-g50 ${v.id === selected ? "bg-g50" : ""} ${v.active ? "" : "opacity-60"}`}
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-bk">{v.plate}</span>
                        <span className="block text-xs text-g500">
                          {v.make} {v.model}
                          {v.year ? `, ${v.year}` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-g600">{v.holder?.name ?? <span className="text-g400">—</span>}</td>
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
            </table>
          </TableScroll>
        )}
      </Card>

      {selected && (
        <VehicleDetail key={selected} id={selected} people={data.people} onChanged={reload} onClose={() => select(null)} />
      )}
    </div>
  );
}
