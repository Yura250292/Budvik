/**
 * «Ваш тиждень» — підсумок у п'ятницю з 16:00.
 *
 * Табло команди приходить лише пушем про зміну місця, а щоденні цифри —
 * на головній. Наприкінці тижня торговому бракує одного рядка: скільки
 * продав, чи більше, ніж минулого тижня, скільки зібрав і де він у команді.
 *
 * Джерело — той самий teamBenchmark, що малює табло в помічнику й рахує
 * пуш про місця: друга реалізація розійшлася б із ним. Про заробіток не
 * пишемо: у базі немає планів і правил мотивації, і сума була б обіцянкою.
 *
 * Модуль без next/*: воркер.
 */

import { prisma } from "@/lib/prisma";
import { teamBenchmark } from "@/lib/analytics/benchmark";
import { shiftDay } from "@/lib/analytics/period";
import { kyivDate, kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { describeWeek, inDigestWindow, isKyivFriday, WEEK_HOUR, weekStart } from "./format";
import { REP_FEED_TYPES, type FeedEvent } from "./types";

function periodOf(fromDay: string, toDay: string, days: number) {
  return { fromDay, toDay, from: kyivDayStart(fromDay), to: kyivDayEnd(toDay), days, clamped: false };
}

export function weekDedupKey(monday: string, repId: string): string {
  return `${REP_FEED_TYPES.WEEK}:${monday}:${repId}`;
}

export async function collectWeekSummaries(now: Date): Promise<FeedEvent[]> {
  if (!isKyivFriday(now) || !inDigestWindow(now, WEEK_HOUR)) return [];

  const day = kyivDate(now);
  const monday = weekStart(day);
  const days = 5;

  const reps = await prisma.user.findMany({ where: { role: "SALES" }, select: { id: true } });
  const keys = reps.map((r) => weekDedupKey(monday, r.id));
  const known = new Set(
    (await prisma.notification.findMany({ where: { dedupKey: { in: keys } }, select: { dedupKey: true } })).map(
      (n) => n.dedupKey
    )
  );
  const salesIds = new Set(reps.map((r) => r.id));
  if (reps.every((r) => known.has(weekDedupKey(monday, r.id)))) return [];

  const [cur, prev] = await Promise.all([
    teamBenchmark(periodOf(monday, day, days)),
    teamBenchmark(periodOf(shiftDay(monday, -7), shiftDay(day, -7), days)),
  ]);

  const board = cur.reps
    .filter((r) => salesIds.has(r.repId) && (r.revenue ?? 0) > 0)
    .sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
  const placeOf = new Map(board.map((r, i) => [r.repId, i + 1]));
  const prevRevenue = new Map(prev.reps.map((r) => [r.repId, r.revenue ?? 0]));

  const events: FeedEvent[] = [];
  for (const r of cur.reps) {
    if (!salesIds.has(r.repId)) continue;
    if ((r.revenue ?? 0) <= 0 && (r.collected ?? 0) <= 0) continue;
    const dedupKey = weekDedupKey(monday, r.repId);
    if (known.has(dedupKey)) continue;

    events.push({
      type: REP_FEED_TYPES.WEEK,
      repId: r.repId,
      dedupKey,
      relatedId: null,
      target: "/sales",
      ...describeWeek({
        revenue: r.revenue ?? 0,
        prevRevenue: prevRevenue.get(r.repId) ?? 0,
        docs: r.docs ?? 0,
        collected: r.collected ?? 0,
        clients: r.clients ?? 0,
        place: placeOf.get(r.repId) ?? null,
        of: board.length,
      }),
      at: now,
      standalone: true,
    });
  }
  return events;
}
