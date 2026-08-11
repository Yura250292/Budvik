"use client";

import { useSyncExternalStore } from "react";
import { money } from "@/components/ui/Stat";
import { kyivToday } from "@/components/ui/PeriodPicker";
import { useDashboardData } from "../DashboardData";
import { Metric, WidgetBody } from "./parts";

/**
 * Годинник і робочий календар місяця.
 *
 * Сенс не в самому часі, а в питанні «скільки ще лишилось»: віджет
 * рахує робочі дні до кінця місяця й перекладає розрив у плані на
 * потрібний темп на день. Це те число, заради якого на план дивляться.
 *
 * Свята не враховуються: офіційний перелік переносів щороку різний і
 * підтягувати його нема звідки, тож рахуємо лише пн–пт і чесно про це
 * пишемо в підказці, а не вигадуємо точність, якої немає.
 */

const KYIV = "Europe/Kyiv";

const timeFmt = new Intl.DateTimeFormat("uk-UA", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: KYIV,
});

const dateFmt = new Intl.DateTimeFormat("uk-UA", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: KYIV,
});

/** Робочі дні (пн–пт) у діапазоні включно. Дати — ISO yyyy-mm-dd. */
function workdaysBetween(fromIso: string, toIso: string): number {
  let count = 0;
  const cur = new Date(`${fromIso}T00:00:00Z`);
  const end = new Date(`${toIso}T00:00:00Z`);
  while (cur <= end) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/** Останній день місяця для ISO-дати. */
function monthEnd(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/**
 * Поточний час як зовнішнє джерело.
 *
 * useSyncExternalStore, а не setState в ефекті: серверний знімок віддає
 * null, тож перший клієнтський рендер збігається з серверним і гідратація
 * не розходиться, а тікання годинника React бере вже з підписки.
 */
function subscribeToClock(cb: () => void) {
  const id = setInterval(cb, 1000);
  return () => clearInterval(id);
}

/** Знімок — з точністю до секунди, щоб не смикати рендер на кожен тік мілісекунд. */
let clockSnapshot: Date | null = null;
function getClockSnapshot(): Date | null {
  const now = new Date();
  if (!clockSnapshot || Math.floor(now.getTime() / 1000) !== Math.floor(clockSnapshot.getTime() / 1000)) {
    clockSnapshot = now;
  }
  return clockSnapshot;
}
const getClockServerSnapshot = (): Date | null => null;

export function ClockWidget() {
  const now = useSyncExternalStore(subscribeToClock, getClockSnapshot, getClockServerSnapshot);
  const { summary } = useDashboardData();

  const today = kyivToday();
  const end = monthEnd(today);
  const left = workdaysBetween(today, end);
  const total = workdaysBetween(`${today.slice(0, 7)}-01`, end);
  const passed = total - left;

  const plan = summary.data?.totals.plan;
  const gap = plan ? Math.max(0, plan.target - plan.actual) : 0;
  // Ділимо на дні, що лишились, включно з сьогоднішнім: сьогодні ще робочий день.
  const perDay = plan && left > 0 ? gap / left : null;

  return (
    <WidgetBody title="Час і календар" hint="Робочі дні — пн–пт, без урахування свят">
      <div className="flex h-full flex-col justify-between gap-3">
        <div>
          <p className="text-[26px] font-bold leading-none tabular-nums text-bk">
            {now ? timeFmt.format(now) : "--:--:--"}
          </p>
          <p className="mt-1 truncate text-[12px] capitalize text-g500">{now ? dateFmt.format(now) : ""}</p>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Metric label="Робочих лишилось" value={String(left)} sub={`з ${total} у місяці`} />
          {plan && plan.target > 0 ? (
            <Metric
              label={gap > 0 ? "Треба на день" : "План"}
              value={gap > 0 ? `${money(perDay ?? 0)} ₴` : "Виконано"}
              tone={gap > 0 ? (plan.attainment >= passed / Math.max(1, total) ? "warn" : "bad") : "good"}
              sub={gap > 0 ? `${money(gap)} ₴ до плану` : undefined}
            />
          ) : (
            <Metric label="Пройшло" value={`${passed} дн.`} sub="від початку місяця" />
          )}
        </div>

        {/* Смуга проходження місяця — швидкий візуальний орієнтир. */}
        <div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-g100">
            <div
              className="h-full rounded-full bg-g400"
              style={{ width: `${total > 0 ? Math.min(100, (passed / total) * 100) : 0}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-g400">
            Місяць пройдено на {total > 0 ? Math.round((passed / total) * 100) : 0}%
          </p>
        </div>
      </div>
    </WidgetBody>
  );
}
