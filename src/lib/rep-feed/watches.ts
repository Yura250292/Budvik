/**
 * «Повідомити, коли приїде»: запити торгового на відсутній товар.
 *
 * Торговий тисне дзвіночок біля відсутньої позиції в каталозі. Кожні п'ять
 * хвилин воркер дивиться, чи став вільний залишок такої позиції більшим за
 * нуль, і якщо так — одна подія в стрічку й пуш. Далі запит вважається
 * виконаним: це рядок стрічки з ключем watchDedupKey, окремого поля немає.
 * Повторна підписка оновлює createdAt і отримує новий ключ.
 *
 * Запити старші за WATCH_MAX_DAYS не перевіряються: позиція, якої не було
 * два місяці, або знята з виробництва, або про неї вже забули.
 *
 * Модуль без next/*: воркер і роут.
 */

import { prisma } from "@/lib/prisma";
import { FREE_STOCK } from "@/lib/analytics/clientOrder";
import { describeWatch } from "./format";
import { REP_FEED_TYPES, type FeedEvent } from "./types";

export const WATCH_MAX_DAYS = 60;
const DAY_MS = 24 * 60 * 60_000;

export function watchDedupKey(watchId: string, createdAt: Date): string {
  return `${REP_FEED_TYPES.WATCH}:${watchId}:${createdAt.getTime()}`;
}

type WatchRow = {
  id: string;
  userId: string;
  createdAt: Date;
  productId: string;
  name: string;
  sku: string | null;
  free: number;
};

async function watchRows(opts: { userId?: string; onlyInStock: boolean; since: Date }): Promise<WatchRow[]> {
  return prisma.$queryRaw<WatchRow[]>`
    SELECT w.id, w."userId", w."createdAt", p.id AS "productId", p.name, p.sku, st.free
    FROM "ProductWatch" w
    JOIN "Product" p ON p.id = w."productId"
    JOIN "User" u ON u.id = w."userId"
    ${FREE_STOCK("p")}
    WHERE w."createdAt" >= ${opts.since}
      AND (${opts.userId ?? null}::text IS NULL OR w."userId" = ${opts.userId ?? null})
      AND (${!opts.onlyInStock} OR st.free > 0)
      AND u.role IN ('SALES', 'ADMIN')
    ORDER BY w."createdAt" DESC
  `;
}

export async function collectWatchEvents(now: Date): Promise<FeedEvent[]> {
  const rows = (
    await watchRows({ onlyInStock: true, since: new Date(now.getTime() - WATCH_MAX_DAYS * DAY_MS) })
  );
  if (rows.length === 0) return [];

  const known = new Set(
    (
      await prisma.notification.findMany({
        where: { dedupKey: { in: rows.map((r) => watchDedupKey(r.id, r.createdAt)) } },
        select: { dedupKey: true },
      })
    ).map((n) => n.dedupKey)
  );

  return rows
    .filter((r) => !known.has(watchDedupKey(r.id, r.createdAt)))
    .map((r) => ({
      type: REP_FEED_TYPES.WATCH,
      repId: r.userId,
      dedupKey: watchDedupKey(r.id, r.createdAt),
      relatedId: r.productId,
      target: "/sales/watches",
      ...describeWatch({ name: r.name, sku: r.sku, free: r.free }),
      at: now,
    }));
}

export type WatchItem = {
  productId: string;
  name: string;
  sku: string | null;
  freeStock: number;
  createdAt: string;
  /** Коли прийшла подія «приїхало»; null — ще чекаємо. */
  arrivedAt: string | null;
};

/** Запити людини з поточним залишком і станом — для сторінки /sales/watches. */
export async function watchesFor(userId: string, now = new Date()): Promise<WatchItem[]> {
  const rows = await watchRows({ userId, onlyInStock: false, since: new Date(0) });
  const events = rows.length
    ? await prisma.notification.findMany({
        where: { dedupKey: { in: rows.map((r) => watchDedupKey(r.id, r.createdAt)) } },
        select: { dedupKey: true, createdAt: true },
      })
    : [];
  const arrived = new Map(events.map((e) => [e.dedupKey, e.createdAt]));
  const stale = now.getTime() - WATCH_MAX_DAYS * DAY_MS;
  return rows
    .filter((r) => r.createdAt.getTime() >= stale || arrived.has(watchDedupKey(r.id, r.createdAt)))
    .map((r) => ({
      productId: r.productId,
      name: r.name,
      sku: r.sku,
      freeStock: r.free,
      createdAt: r.createdAt.toISOString(),
      arrivedAt: arrived.get(watchDedupKey(r.id, r.createdAt))?.toISOString() ?? null,
    }));
}
