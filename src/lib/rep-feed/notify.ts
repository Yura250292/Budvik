/**
 * Стрічка торгового: записати події й розіслати пуші.
 *
 * Викликається воркером раз на 5 хвилин (worker/index.ts, pushRepFeed) і
 * скриптом scripts/rep-feed-notify.mts. Один прохід:
 *
 *   курсор → зібрати події → записати рядки (дублі — «вже знаємо») →
 *   згрупувати по торговому → вирішити про пуш → надіслати → посунути курсор.
 *
 * Три джерела подій:
 *   - events.ts — оплати, документи, склад, доставка: читаються «з курсора»;
 *   - visit-card.ts — зупинка біля клієнта: читається «зараз» із треку;
 *   - call-list.ts — список дзвінків: раз на день об 11:00.
 * Два останні мають власний ключ дедуплікації по дню і не залежать від
 * курсора; їхні помилки не зупиняють головну стрічку.
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
import { collectCallLists } from "./call-list";
import { collectEvents } from "./events";
import {
  CURSOR_OVERLAP_MS,
  DAILY_PUSH_CAP,
  docDayFloor,
  groupPush,
  inPushHours,
  MAX_EVENTS_PER_TICK,
} from "./format";
import { isPushMuted, parsePushPrefs, type PushPrefs } from "./prefs";
import type { FeedEvent } from "./types";
import { collectVisitCards } from "./visit-card";

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

/** Джерело, яке не має права зупинити головну стрічку своєю помилкою. */
async function safely(label: string, run: () => Promise<FeedEvent[]>): Promise<FeedEvent[]> {
  try {
    return await run();
  } catch (e) {
    console.error(`[rep-feed] ${label} впав:`, e);
    return [];
  }
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

  // Головна стрічка кидає далі: без неї курсор рухати не можна.
  const events = [
    ...(await collectEvents(since, docDayFloor(now))),
    ...(await safely("картка перед візитом", () => collectVisitCards(now))),
    ...(await safely("список дзвінків", () => collectCallLists(now))),
  ];

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

  const users = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: [...byRep.keys()] } },
        select: { id: true, name: true, notificationPrefs: true },
      })
    ).map((u) => [u.id, { name: u.name, prefs: parsePushPrefs(u.notificationPrefs) as PushPrefs }])
  );

  const brake = events.length > MAX_EVENTS_PER_TICK;
  const quiet = !inPushHours(now);
  const dayStart = kyivDayStart(kyivDate(now));

  const pushes: PushDecision[] = [];
  for (const [repId, items] of byRep) {
    const user = users.get(repId);
    const name = user?.name ?? null;

    // Вимкнене в профілі — у стрічку так, у пуш ні.
    const muted = items.filter((i) => isPushMuted(user?.prefs, i.event.type));
    const live = items.filter((i) => !isPushMuted(user?.prefs, i.event.type));
    if (muted.length > 0) {
      const g = groupPush(muted.map((i) => i.event));
      pushes.push({ repId, name, ...g, events: muted.length, sent: false, why: "вимкнено в профілі" });
    }
    if (live.length === 0) continue;

    /**
     * Одиниці розсилки: картка візиту й список дзвінків — кожен своїм
     * пушем (у заголовку «3 події» вони гинуть), решта — одним зведеним.
     */
    const units: Inserted[][] = [];
    for (const i of live) if (i.event.standalone) units.push([i]);
    const grouped = live.filter((i) => !i.event.standalone);
    if (grouped.length > 0) units.push(grouped);

    let pushedToday: number | null = null;

    for (const unit of units) {
      const g = groupPush(unit.map((i) => i.event));
      const base = { repId, name, ...g, events: unit.length };

      if (brake) {
        pushes.push({ ...base, sent: false, why: `аварійне гальмо: ${events.length} подій за тік` });
        continue;
      }
      if (quiet) {
        pushes.push({ ...base, sent: false, why: "тихі години — лише в стрічку" });
        continue;
      }
      if (pushedToday == null) {
        pushedToday = await prisma.notification.count({
          where: { userId: repId, pushedAt: { gte: dayStart } },
        });
      }
      if (pushedToday >= DAILY_PUSH_CAP) {
        pushes.push({ ...base, sent: false, why: `денна стеля ${DAILY_PUSH_CAP} вичерпана` });
        continue;
      }

      if (dry) {
        pushedToday++;
        pushes.push({ ...base, sent: false, why: "dry — надіслали б" });
        continue;
      }

      await sendPushToUser(repId, {
        title: g.title,
        body: g.body,
        data: { screen: "/cabinet", target: g.target },
        /**
         * Пробити режим сну — планшет лежить у машині з погашеним екраном,
         * і без високого пріоритету Android притримує сповіщення до
         * наступного пробудження. Обсяг обмежений денною стелею.
         */
        urgent: true,
      });
      await prisma.notification.updateMany({
        where: { id: { in: unit.map((i) => i.notificationId).filter((id): id is string => !!id) } },
        data: { pushedAt: now },
      });
      pushedToday++;
      pushes.push({ ...base, sent: true, why: "надіслано" });
    }
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
