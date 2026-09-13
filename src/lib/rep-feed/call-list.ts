/**
 * «Кому подзвонити сьогодні» — один рядок і один пуш об 11:00.
 *
 * Помічник давно вміє відповісти на це питання (`action_candidates`), але
 * його треба спитати. Об 11:00 торговий уже на маршруті й до обіду має
 * пів дня, у які можна вставити три дзвінки, — саме тоді список і має
 * прийти сам.
 *
 * Кого не турбуємо: у вихідний — нікого; у будень — того, хто сьогодні не
 * працює (немає ні відкритої зміни, ні жодної точки треку за день).
 * Пуш «подзвоніть» людині у відпустці — перший крок до вимкнення каналу.
 */

import { prisma } from "@/lib/prisma";
import { repActionCandidates, ACTION_LABELS, type ActionKind } from "@/lib/analytics/company/rep-actions";
import { shiftDay } from "@/lib/analytics/period";
import { KYIV_TZ, kyivDate, kyivDayEnd, kyivDayStart, kyivHour } from "@/lib/date/kyiv";
import { describeCallList } from "./format";
import { isInternalCounterparty, loadStaffNames } from "./internal";
import { REP_FEED_TYPES, type FeedEvent } from "./types";

export const CALL_LIST_HOUR = 11;

/** Скільки клієнтів у списку. */
const TOP = 5;

/** Вікно, за яким рахуються ритм і ризик, — те саме, що в помічнику. */
const WINDOW_DAYS = 30;

/** Спершу гроші, потім ті, кого можна втратити, потім усе інше. */
const KIND_ORDER: Record<ActionKind, number> = {
  COLLECT_DEBT: 0,
  CHURN_RISK: 1,
  REACTIVATE: 2,
  DEVELOP: 3,
  OFFER_BONUS: 4,
};

export function callListDedupKey(day: string, repId: string): string {
  return `${REP_FEED_TYPES.CALL_LIST}:${day}:${repId}`;
}

export function isWeekend(now: Date): boolean {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: KYIV_TZ, weekday: "short" }).format(now);
  return wd === "Sat" || wd === "Sun";
}

/** Працює сьогодні: відкрита зміна або хоч одна точка треку за день. */
async function worksToday(repId: string, day: string): Promise<boolean> {
  const open = await prisma.shift.count({ where: { userId: repId, status: "OPEN" } });
  if (open > 0) return true;
  const points = await prisma.trackPoint.count({
    where: { userId: repId, recordedAt: { gte: kyivDayStart(day) } },
  });
  return points > 0;
}

export async function collectCallLists(now: Date): Promise<FeedEvent[]> {
  if (kyivHour(now) !== CALL_LIST_HOUR || isWeekend(now)) return [];

  const day = kyivDate(now);
  const fromDay = shiftDay(day, -(WINDOW_DAYS - 1));
  const period = {
    fromDay,
    toDay: day,
    from: kyivDayStart(fromDay),
    to: kyivDayEnd(day),
    days: WINDOW_DAYS,
    clamped: false,
  };

  const reps = await prisma.user.findMany({ where: { role: "SALES" }, select: { id: true } });
  const staff = await loadStaffNames();
  const events: FeedEvent[] = [];

  for (const { id: repId } of reps) {
    const dedupKey = callListDedupKey(day, repId);
    const known = await prisma.notification.findUnique({ where: { dedupKey }, select: { id: true } });
    if (known) continue;
    if (!(await worksToday(repId, day))) continue;

    // Склад, співробітники й картки на ім'я торгових — не клієнти, дзвонити
    // їм «забрати борг» нема сенсу, а в топ вони лізуть першими.
    const all = (await repActionCandidates(repId, period)).filter(
      (c) => !isInternalCounterparty(c.name, staff)
    );
    if (all.length === 0) continue;

    const top = [...all]
      .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.overdue - a.overdue || b.debt - a.debt)
      .slice(0, TOP);

    events.push({
      type: REP_FEED_TYPES.CALL_LIST,
      repId,
      dedupKey,
      relatedId: null,
      target: "/sales/clients",
      ...describeCallList(top.map((c) => ({ name: c.name, action: ACTION_LABELS[c.kind] }))),
      at: now,
      standalone: true,
    });
  }
  return events;
}
