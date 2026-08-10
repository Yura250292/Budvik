"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { StatCard, money, num } from "@/components/ui/Stat";
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
 * — три різні розмови, і плутати їх не варто.
 */

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-g400">{title}</h2>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </section>
  );
}

/** Картка-посилання: та сама StatCard, але веде в дрілл. */
function LinkedStat({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="block cursor-pointer rounded-[var(--radius-card)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-dark motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      {children}
    </Link>
  );
}

export function MetricGrid({ row, moneyHref }: { row: SummaryRow; moneyHref: string }) {
  const overdue = row.receivables.overdue > 0;

  return (
    <>
      <Group title="Гроші">
        <StatCard
          label="Оборот"
          value={money(row.revenue)}
          unit="₴"
          hint="відвантажено за період"
          accent={CATEGORICAL[0]}
        />
        <StatCard
          label="Зібрано"
          value={money(row.collected)}
          unit="₴"
          hint={
            row.revenue > 0
              ? `${num((row.collected / row.revenue) * 100)}% від обороту`
              : "гроші, що зайшли в офіс"
          }
          accent={CATEGORICAL[4]}
        />
        <div className="col-span-2">
          <LinkedStat href={moneyHref}>
            <StatCard
              label="Заробіток"
              value={row.earnings ? money(row.earnings.total) : "—"}
              unit={row.earnings ? "₴" : undefined}
              hint={
                row.earnings
                  ? row.earnings.penalties > 0
                    ? `нараховано ${money(row.earnings.gross)}, утримано ${money(row.earnings.penalties)}`
                    : `зі зібраного за схемою «${row.earnings.schemeName}»`
                  : "схему мотивації не призначено"
              }
              accent={CATEGORICAL[2]}
              tone={row.earnings ? "good" : "default"}
            />
          </LinkedStat>
        </div>
      </Group>

      <Group title="Робота">
        <StatCard label="Документів" value={num(row.docs)} hint="проведено за період" />
        <StatCard label="Клієнтів" value={num(row.clients)} hint="унікальних за період" />
        <StatCard label="Середній чек" value={money(row.avgCheck)} unit="₴" />
        <StatCard
          label="Паливо"
          value={money(row.fuel.cost)}
          unit="₴"
          hint={
            row.fuel.hasVehicle
              ? `${num(row.fuel.workKm)} робочих км`
              : `${num(row.fuel.workKm)} км · норма типова`
          }
          accent={CATEGORICAL[1]}
        />
      </Group>

      <Group title="Ризик і результат">
        <LinkedStat href={moneyHref}>
          <StatCard
            label="Дебіторка"
            value={money(row.receivables.total)}
            unit="₴"
            hint={
              overdue
                ? `прострочено ${money(row.receivables.overdue)} (${num(row.receivables.overdueRatio)}%)`
                : "простроченої немає"
            }
            tone={overdue ? "bad" : "good"}
          />
        </LinkedStat>
        <StatCard
          label="Чистий результат"
          value={money(row.net)}
          unit="₴"
          hint={`прибуток ${money(row.profit)} ₴ мінус пальне`}
          tone={row.net >= 0 ? "good" : "bad"}
        />
      </Group>
    </>
  );
}
