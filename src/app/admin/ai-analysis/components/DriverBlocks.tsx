"use client";

/**
 * Секція «Логістика»: ефективність кожного водія за маршрутними листами.
 *
 * Дві цифри інкасації показуються поруч і НЕ сумуються — для маршрутів сайту
 * друга виводиться з першої, і сума була б подвійним рахунком. Підпис під
 * ними каже це вголос, щоб ніхто не склав їх подумки.
 */

import { useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { money, num } from "@/components/ui/Stat";
import { InsightSections } from "@/app/admin/sales-analytics/components/InsightCard";
import { DrillButton } from "./DrillLink";
import { driverHref } from "./links";
import type { Insight } from "@/lib/ai/insights";

type Payload = {
  overall: Insight[];
  drivers: Array<{ driverId: string; insights: Insight[]; watch: string[] }>;
};

type DriverFacts = {
  driverId: string;
  водій: string;
  листів: number;
  кілометрів: number;
  факт_проти_плану_відсотків: number | null;
  листів_без_кілометражу: number;
  точки: { місто: number; область: number; оплачуваних_разом: number };
  зарплата: number;
  привезений_оборот: number;
  грн_за_точку: number | null;
  км_на_точку: number | null;
  зарплата_до_обороту_відсотків: number | null;
  інкасація: { за_відмітками: number; борги_з_листів: number };
  аномалії: {
    підозрілих_змін: number;
    закрито_автоматично: number;
    одометр_до_gps: number | null;
    порівняння_є_для_змін: string;
    листів_понад_план_на_30_відсотків: number;
  };
};

type Facts = {
  підсумок?: {
    водіїв: number;
    листів: number;
    листів_без_водія: number;
    кілометрів: number | null;
    оплачуваних_точок: number;
    зарплата: number | null;
    привезений_оборот: number | null;
    зарплата_до_обороту_відсотків: number | null;
    оборот_відомий_для_листів?: string;
    інкасація_за_відмітками: number | null;
  };
  медіани_команди?: {
    грн_за_точку: number | null;
    км_на_точку: number | null;
    зарплата_до_обороту_відсотків: number | null;
  };
  водії?: DriverFacts[];
};

export function DriverBlocks({
  payload,
  facts,
  period,
}: {
  payload: unknown;
  facts: unknown;
  period: { from: string; to: string };
}) {
  const p = (payload ?? {}) as Payload;
  const f = (facts ?? {}) as Facts;
  const byId = new Map((f.водії ?? []).map((d) => [d.driverId, d]));
  const [open, setOpen] = useState<string | null>(p.drivers?.[0]?.driverId ?? null);
  const med = f.медіани_команди;

  return (
    <div className="flex flex-col gap-3">
      {f.підсумок && (
        <Card>
          <CardHeader title="Логістика за період" hint="Маршрути сайту й листи 1С разом" />
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Листів" value={num(f.підсумок.листів)} hint={
              f.підсумок.листів_без_водія > 0
                ? `${num(f.підсумок.листів_без_водія)} без водія`
                : undefined
            } />
            <Metric label="Кілометрів" value={num(f.підсумок.кілометрів ?? 0, 1)} />
            <Metric label="Оплачуваних точок" value={num(f.підсумок.оплачуваних_точок)} />
            <Metric label="Зарплата" value={`${money(f.підсумок.зарплата ?? 0)} ₴`} />
          </dl>

          <p className="mt-3 text-xs text-g500">
            Інкасація за відмітками на планшеті: {money(f.підсумок.інкасація_за_відмітками ?? 0)} ₴.
            {f.підсумок.оборот_відомий_для_листів && (
              <>
                {" "}
                Привезений оборот заповнений лише в маршрутах сайту —{" "}
                {f.підсумок.оборот_відомий_для_листів} листів, тому відношення зарплати до обороту
                ({num(f.підсумок.зарплата_до_обороту_відсотків ?? 0, 1)}%) рахується тільки по них.
              </>
            )}
          </p>

          {med && (
            <p className="mt-1 text-xs text-g500">
              Медіани команди: {money(med.грн_за_точку ?? 0)} ₴ за точку ·{" "}
              {num(med.км_на_точку ?? 0, 1)} км на точку.
            </p>
          )}
        </Card>
      )}

      {p.overall?.length > 0 && (
        <Card>
          <CardHeader title="Висновки по логістиці" />
          <InsightSections insights={p.overall} />
        </Card>
      )}

      {p.drivers?.length ? (
        <Card padded={false}>
          <div className="border-b border-g200 p-4 sm:p-5">
            <h2 className="text-sm font-semibold text-bk">По кожному водію</h2>
            <p className="mt-0.5 text-xs text-g500">
              Одометр до GPS у нормі 1,2–1,6: трек іде по прямій, а дорога довша.
            </p>
          </div>

          <ul className="divide-y divide-g200">
            {p.drivers.map((block) => {
              const d = byId.get(block.driverId);
              if (!d) return null;
              const isOpen = open === block.driverId;
              const pricey =
                med?.грн_за_точку != null &&
                d.грн_за_точку != null &&
                d.грн_за_точку > med.грн_за_точку * 1.25;

              return (
                <li key={block.driverId}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : block.driverId)}
                    aria-expanded={isOpen}
                    className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-g50 sm:px-5"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-bk">{d.водій}</span>
                      <span className="text-xs text-g500">
                        {num(d.листів)} листів · {num(d.кілометрів, 1)} км ·{" "}
                        {num(d.точки.оплачуваних_разом)} точок · {money(d.зарплата)} ₴
                      </span>
                    </span>

                    <span className="flex flex-wrap items-center gap-1.5">
                      {d.грн_за_точку != null && (
                        <Badge status={pricey ? "warn" : "neutral"}>
                          {money(d.грн_за_точку)} ₴/точку
                        </Badge>
                      )}
                      {d.аномалії.підозрілих_змін > 0 && (
                        <Badge status="bad">
                          підозрілих змін {num(d.аномалії.підозрілих_змін)}
                        </Badge>
                      )}
                      {d.листів_без_кілометражу > 0 && (
                        <Badge status="warn">без км {num(d.листів_без_кілометражу)}</Badge>
                      )}
                      <span className="text-xs text-g400">
                        {isOpen ? "згорнути" : "розгорнути"}
                      </span>
                    </span>
                  </button>

                  {isOpen && (
                    <div className="flex flex-col gap-4 border-t border-g100 bg-g50 px-4 py-4 sm:px-5">
                      <div className="flex flex-wrap gap-2">
                        <DrillButton href={driverHref(block.driverId, period.from, period.to)}>
                          Зарплата і маршрутні листи
                        </DrillButton>
                      </div>

                      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <Metric label="Км на точку" value={num(d.км_на_точку ?? 0, 1)} />
                        <Metric
                          label="Точки"
                          value={`${num(d.точки.місто)} / ${num(d.точки.область)}`}
                          hint="місто / область"
                        />
                        <Metric
                          label="Факт проти плану"
                          value={
                            d.факт_проти_плану_відсотків != null
                              ? `${d.факт_проти_плану_відсотків > 0 ? "+" : ""}${num(
                                  d.факт_проти_плану_відсотків,
                                  1
                                )}%`
                              : "плану немає"
                          }
                        />
                        <Metric
                          label="Одометр до GPS"
                          value={
                            d.аномалії.одометр_до_gps != null
                              ? num(d.аномалії.одометр_до_gps, 2)
                              : "немає даних"
                          }
                          hint={`порівняння є для ${d.аномалії.порівняння_є_для_змін} змін`}
                        />
                      </dl>

                      <p className="text-xs text-g500">
                        Інкасація: {money(d.інкасація.за_відмітками)} ₴ за відмітками на планшеті,{" "}
                        {money(d.інкасація.борги_з_листів)} ₴ борги з листів. Це два різні
                        свідчення про ті самі гроші — не додавайте їх.
                      </p>

                      {block.insights?.length > 0 && <InsightSections insights={block.insights} />}

                      {block.watch?.length > 0 && (
                        <section>
                          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-g500">
                            На що подивитися
                          </h3>
                          <ul className="flex flex-col gap-1">
                            {block.watch.map((w, i) => (
                              <li key={i} className="text-sm text-g700">
                                • {w}
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <Card>
          <EmptyState
            title="Немає блоків по водіях"
            hint="За обраний період маршрутних листів із прив'язаним водієм не знайшлося."
          />
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-g500">{label}</dt>
      <dd className="text-base font-semibold text-bk">{value}</dd>
      {hint && <p className="text-xs text-g400">{hint}</p>}
    </div>
  );
}
