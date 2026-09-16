/**
 * «Пропозиція спрацювала» — торговий дізнається, що його повідомлення дало
 * накладну.
 *
 * Без цього рядка петля не замикається: торговий пише сплячому клієнту,
 * клієнт через тиждень замовляє через офіс, а торговий так і не знає, що
 * саме його Viber повернув людину. Наступного вівторка йому буде нема чого
 * писати «ще п'ятьом».
 *
 * Джерело — ClientOutreach, закриті воркером як ORDERED
 * (src/lib/outreach/settle.ts). Ручні відмітки (outcomeBy = 'REP') сюди не
 * йдуть: торговий їх поставив сам і новиною вони для нього не є.
 *
 * Модуль без next/*: воркер.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";
import { labelOf, OUTREACH_KINDS } from "@/lib/outreach/types";
import { describeOutreachResult, inPushHours } from "./format";
import { REP_FEED_TYPES, type FeedEvent } from "./types";

/** Скільки днів назад дивимось на закриті пропозиції. */
export const OUTREACH_RESULT_LOOKBACK_DAYS = 2;

const DAY_MS = 86_400_000;

export function outreachResultDedupKey(outreachId: string): string {
  return `${REP_FEED_TYPES.OUTREACH_RESULT}:${outreachId}`;
}

/** Різниця київських календарних днів: «написали вчора», а не «23 години тому». */
export function kyivDaysBetween(from: Date, to: Date): number {
  const a = Date.parse(`${kyivDate(from)}T12:00:00Z`);
  const b = Date.parse(`${kyivDate(to)}T12:00:00Z`);
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

export async function collectOutreachResults(now: Date): Promise<FeedEvent[]> {
  /**
   * Лише в години пушів. Воркер закриває пропозиції цілодобово, а нічний
   * повний прогін обміну довозить накладні саме вночі. Подія, записана о
   * 02:00, лягла б у стрічку мовчки і вранці вже була б «відомою» — пуша про
   * найприємнішу новину тижня торговий не отримав би ніколи. Тому нічна
   * подія чекає восьмої ранку; дводенного вікна вистачає з запасом, навіть
   * якщо воркер уночі перезапускався.
   */
  if (!inPushHours(now)) return [];

  const rows = await prisma.clientOutreach.findMany({
    where: {
      outcome: "ORDERED",
      outcomeBy: "WORKER",
      outcomeAt: { gte: new Date(now.getTime() - OUTREACH_RESULT_LOOKBACK_DAYS * DAY_MS), lte: now },
      repId: { not: null },
      // Лише торговим: пропозицію могли записати й з офісної обліковки, а
      // стрічка й пуші — кабінет торгового.
      rep: { is: { role: "SALES" } },
    },
    select: {
      id: true,
      counterpartyId: true,
      repId: true,
      kind: true,
      sentAt: true,
      outcomeAt: true,
      outcomeAmount: true,
      counterparty: { select: { name: true } },
    },
    orderBy: { outcomeAt: "asc" },
  });
  if (rows.length === 0) return [];

  // Відомі відсіюємо тут, а не покладаємось на унікальний ключ: аварійне
  // гальмо в notify.ts рахує ВСІ зібрані події, і дводенне вікно інакше
  // щотіку додавало б у лічильник уже записані рядки.
  const known = new Set(
    (
      await prisma.notification.findMany({
        where: { dedupKey: { in: rows.map((r) => outreachResultDedupKey(r.id)) } },
        select: { dedupKey: true },
      })
    ).map((n) => n.dedupKey)
  );

  const events: FeedEvent[] = [];
  for (const r of rows) {
    const dedupKey = outreachResultDedupKey(r.id);
    if (known.has(dedupKey) || !r.repId) continue;
    events.push({
      type: REP_FEED_TYPES.OUTREACH_RESULT,
      repId: r.repId,
      dedupKey,
      relatedId: r.counterpartyId,
      target: `/sales/clients/${r.counterpartyId}`,
      ...describeOutreachResult({
        name: r.counterparty.name,
        kind: labelOf(OUTREACH_KINDS, r.kind),
        sentDaysAgo: kyivDaysBetween(r.sentAt, now),
        amount: r.outcomeAmount,
      }),
      at: r.outcomeAt ?? now,
    });
  }
  return events;
}
