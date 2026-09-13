/**
 * Стрічка торгового: записати події й розіслати пуші.
 *
 * Викликається воркером раз на 5 хвилин (worker/index.ts, pushRepFeed) і
 * скриптом scripts/rep-feed-notify.mts. Один прохід:
 *
 *   курсор → зібрати події → записати рядки (дублі — «вже знаємо») →
 *   згрупувати по торговому → вирішити про пуш → надіслати → посунути курсор.
 *
 * Чому не гак в обробнику обміну, як у складських сповіщень
 * (warehouse/pick-notify.ts). Джерела живуть у двох деплоях: оплати й
 * документи пише обмін у воркері, а позначки складу й доставку — роути на
 * Vercel; гаків було б п'ять. До того ж «3 події у клієнтів» одним пушем
 * потребує межі тіку, а гак спрацьовує посеред прогону на кожну пачку.
 *
 * Порядок «спершу запис, потім пуш» — той самий, що у складу: якщо Expo
 * лежить, людина не отримає сповіщення, але побачить рядок; а от повторний
 * пуш про ту саму оплату кожні п'ять хвилин — це те, після чого канал
 * вимикають назавжди.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { sendPushToUser } from "@/lib/push/send";
import { getSyncState, setSyncState } from "@/lib/sync-ingest/context";
import { collectEvents } from "./events";
import {
  CURSOR_OVERLAP_MS,
  DAILY_PUSH_CAP,
  docDayFloor,
  groupPush,
  inPushHours,
  MAX_EVENTS_PER_TICK,
} from "./format";
import type { FeedEvent } from "./types";

/** Ключ курсора в SyncState: ISO-момент початку останнього успішного тіку. */
export const CURSOR_KEY = "repFeed:cursor";

export type PushDecision = {
  repId: string;
  name: string | null;
  title: string;
  body: string;
  target: string;
  /** Скільки нових подій зібрано в цей пуш. */
  events: number;
  sent: boolean;
  why: string;
};

export type RepFeedRun = {
  /** Курсора не було — поставили «зараз» і нічого не слали. */
  warmed: boolean;
  since: Date | null;
  /** Усе, що знайшли детектори (включно з уже відомими). */
  events: FeedEvent[];
  /** Скільки з них нових (записано в стрічку). */
  inserted: number;
  known: number;
  pushes: PushDecision[];
};

type Inserted = { event: FeedEvent; notificationId: string | null };

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Один прохід стрічки.
 *
 * `dry` — нічого не пише (ні рядків, ні курсора) і нічого не шле, але
 * рішення показує чесно: відомі події позначає як відомі, стелю рахує з
 * бази. `since` — лише для dry-прогонів: подивитись, що дав би тік із
 * заданого моменту, не чіпаючи курсор.
 */
export async function notifyRepFeed(
  opts: { now?: Date; dry?: boolean; since?: Date } = {}
): Promise<RepFeedRun> {
  const now = opts.now ?? new Date();
  const dry = opts.dry === true;

  let since: Date;
  if (opts.since) {
    if (!dry) throw new Error("notifyRepFeed: since дозволений лише з dry");
    since = opts.since;
  } else {
    const raw = await getSyncState(CURSOR_KEY);
    const cursor = raw ? new Date(raw) : null;
    if (!cursor || Number.isNaN(cursor.getTime())) {
      // Перший запуск: історію не програємо. Усе, що було до цієї миті, —
      // не новина, а те, що торговий і так бачить у документах.
      if (!dry) await setSyncState(CURSOR_KEY, now.toISOString());
      return { warmed: true, since: null, events: [], inserted: 0, known: 0, pushes: [] };
    }
    since = new Date(cursor.getTime() - CURSOR_OVERLAP_MS);
  }

  const events = await collectEvents(since, docDayFloor(now));

  // ---- запис: нові проти відомих ----
  const fresh: Inserted[] = [];
  let known = 0;

  if (dry) {
    const seen = new Set(
      (
        await prisma.notification.findMany({
          where: { dedupKey: { in: events.map((e) => e.dedupKey) } },
          select: { dedupKey: true },
        })
      ).map((n) => n.dedupKey)
    );
    for (const event of events) {
      if (seen.has(event.dedupKey)) known++;
      else fresh.push({ event, notificationId: null });
    }
  } else {
    for (const event of events) {
      try {
        const row = await prisma.notification.create({
          data: {
            userId: event.repId,
            type: event.type,
            title: event.title,
            body: event.body,
            relatedId: event.relatedId,
            dedupKey: event.dedupKey,
          },
          select: { id: true },
        });
        fresh.push({ event, notificationId: row.id });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        known++;
      }
    }
  }

  // ---- рішення про пуш, по торговому ----
  const byRep = new Map<string, Inserted[]>();
  for (const item of fresh) {
    const list = byRep.get(item.event.repId) ?? [];
    list.push(item);
    byRep.set(item.event.repId, list);
  }

  const names = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: [...byRep.keys()] } },
        select: { id: true, name: true },
      })
    ).map((u) => [u.id, u.name])
  );

  const brake = events.length > MAX_EVENTS_PER_TICK;
  const quiet = !inPushHours(now);
  const dayStart = kyivDayStart(kyivDate(now));

  const pushes: PushDecision[] = [];
  for (const [repId, items] of byRep) {
    const grouped = groupPush(items.map((i) => i.event));
    const base = {
      repId,
      name: names.get(repId) ?? null,
      ...grouped,
      events: items.length,
    };

    if (brake) {
      pushes.push({ ...base, sent: false, why: `аварійне гальмо: ${events.length} подій за тік` });
      continue;
    }
    if (quiet) {
      pushes.push({ ...base, sent: false, why: "тихі години — лише в стрічку" });
      continue;
    }
    const pushedToday = await prisma.notification.count({
      where: { userId: repId, pushedAt: { gte: dayStart } },
    });
    if (pushedToday >= DAILY_PUSH_CAP) {
      pushes.push({ ...base, sent: false, why: `денна стеля ${DAILY_PUSH_CAP} вичерпана` });
      continue;
    }

    if (dry) {
      pushes.push({ ...base, sent: false, why: "dry — надіслали б" });
      continue;
    }

    await sendPushToUser(repId, {
      title: grouped.title,
      body: grouped.body,
      data: { screen: "/cabinet", target: grouped.target },
      /**
       * Пробити режим сну — планшет лежить у машині з погашеним екраном,
       * і без високого пріоритету Android притримує сповіщення до наступного
       * пробудження. Обсяг обмежений денною стелею, тож це не спам.
       */
      urgent: true,
    });
    await prisma.notification.updateMany({
      where: { id: { in: items.map((i) => i.notificationId).filter((id): id is string => !!id) } },
      data: { pushedAt: now },
    });
    pushes.push({ ...base, sent: true, why: "надіслано" });
  }

  if (brake) {
    console.warn(
      `[rep-feed] аварійне гальмо: ${events.length} подій за тік (межа ${MAX_EVENTS_PER_TICK}), пушів не було`
    );
  }

  // Курсор — в кінці й лише після успіху: якщо детектор упав, наступний тік
  // перечитає той самий відрізок, а дублі рядків не страшні завдяки ключу.
  if (!dry && !opts.since) await setSyncState(CURSOR_KEY, now.toISOString());

  return { warmed: false, since, events, inserted: fresh.length, known, pushes };
}
