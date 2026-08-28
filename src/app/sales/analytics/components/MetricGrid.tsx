"use client";

import type { ReactNode } from "react";
import { money, num } from "@/components/ui/Stat";
import { StatCard } from "@/components/cabinet/ui";
import { CATEGORICAL } from "@/lib/analytics/colors";
import type { SummaryRow } from "./useSalesAnalytics";

/**
 * Решта показників зведеної — картками, а не рядком таблиці.
 *
 * У адміна це 11 колонок шириною 1180px: там треба порівнювати торгових
 * між собою. Тут порівнювати нема з ким — свій рядок один, тож таблиця
 * перетворюється на купу чисел, які на телефоні доводиться гортати вбік.
 *
 * Групи розділені підписами, а не лише відступом: гроші, робота і ризик
 * — три різні розмови, і плутати їх не варто. Часову рамку кожної групи
 * підписано праворуч від заголовка: без цього оборот за 10 днів поруч із
 * боргом «станом на зараз» читається як помилка в даних.
 */

function Group({ title, frame, children }: { title: string; frame: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <h2 className="text-[13px] font-semibold text-bk">{title}</h2>
        <span className="text-xs text-cab-t3">{frame}</span>
      </div>
      {children}
    </section>
  );
}

function Pair({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5">{children}</div>;
}

export function MetricGrid({ row, moneyHref }: { row: SummaryRow; moneyHref: string }) {
  const overdue = row.receivables.overdue > 0;
  const collectedRatio = row.revenue > 0 ? (row.collected / row.revenue) * 100 : null;

  return (
    <>
      <Group title="Гроші" frame="за обраний період">
        <Pair>
          <StatCard
            label="Оборот"
            value={money(row.revenue)}
            unit="₴"
            hint="відвантажено за період"
            dot={CATEGORICAL[0]}
          />
          <StatCard
            label="Зібрано"
            value={money(row.collected)}
            unit="₴"
            dot={CATEGORICAL[4]}
            hint={
              collectedRatio == null ? (
                <p className="text-xs text-cab-t3">гроші, що зайшли в офіс</p>
              ) : (
                /* Смужка, а не лише відсоток: «74 %» саме по собі нічого не
                   каже, а видима частка від обороту — каже одразу. */
                <div className="flex flex-col gap-1.5">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-cab-line">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(0, collectedRatio))}%`,
                        background: CATEGORICAL[4],
                      }}
                    />
                  </div>
                  <p className="text-xs text-cab-t3">{num(collectedRatio)}% від обороту</p>
                </div>
              )
            }
          />
        </Pair>
        <StatCard
          label="Заробіток"
          value={row.earnings ? money(row.earnings.total) : "—"}
          unit={row.earnings ? "₴" : undefined}
          dot={CATEGORICAL[2]}
          href={moneyHref}
          hint={
            row.earnings
              ? row.earnings.penalties > 0
                ? `зі зібраного за схемою «${row.earnings.schemeName}» · нараховано ${money(row.earnings.gross)}, утримано ${money(row.earnings.penalties)}`
                : `зі зібраного за схемою «${row.earnings.schemeName}»`
              : "схему мотивації не призначено"
          }
        />
      </Group>

      <Group title="Робота" frame="за обраний період">
        <Pair>
          <StatCard label="Документів" value={num(row.docs)} hint="проведено за період" dot={CATEGORICAL[0]} />
          <StatCard label="Клієнтів" value={num(row.clients)} hint="унікальних за період" dot={CATEGORICAL[0]} />
        </Pair>
        <Pair>
          <StatCard
            label="Середній чек"
            value={money(row.avgCheck)}
            unit="₴"
            hint="по проведених документах"
            dot={CATEGORICAL[0]}
          />
          <StatCard
            label="Паливо"
            value={money(row.fuel.cost)}
            unit="₴"
            dot={CATEGORICAL[1]}
            hint={
              row.fuel.hasVehicle
                ? `${num(row.fuel.workKm)} робочих км`
                : `${num(row.fuel.workKm)} км · норма типова`
            }
          />
        </Pair>
      </Group>

      <Group title="Ризик і результат" frame="борг — станом на зараз">
        <Pair>
          <StatCard
            label="Дебіторка"
            value={money(row.receivables.total)}
            unit="₴"
            href={moneyHref}
            dot={CATEGORICAL[0]}
            hint={
              overdue
                ? `прострочено ${money(row.receivables.overdue)} (${num(row.receivables.overdueRatio)}%)`
                : "простроченої немає"
            }
          />
          <StatCard
            label="Чистий результат"
            value={money(row.net)}
            unit="₴"
            dot={CATEGORICAL[0]}
            hint={`прибуток ${money(row.profit)} ₴ мінус пальне`}
          />
        </Pair>
      </Group>
    </>
  );
}
