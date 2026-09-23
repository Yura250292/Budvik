/**
 * Сторінка стрічки: рядки Notification з префіксом REP_, найновіші першими.
 *
 * Спільна для кабінету торгового (лише свої рядки) і адмінки (усі торгові,
 * з іменем біля кожного рядка). Курсор — «createdAt|id» останнього рядка:
 * лише за часом рядки однієї пачки воркера (той самий тік) могли б
 * загубитися на межі сторінки.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { filterTypes, REP_FEED_PREFIX } from "./types";

export const FEED_PAGE = 40;

export type FeedRowOut = {
  id: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  relatedId: string | null;
  createdAt: string;
  rep: { id: string; name: string } | null;
};

function parseCursor(raw: string | null | undefined): { at: Date; id: string } | null {
  if (!raw) return null;
  const [iso, id] = raw.split("|");
  const at = new Date(iso ?? "");
  if (!id || Number.isNaN(at.getTime())) return null;
  return { at, id };
}

export async function feedPage(opts: {
  /** Лише рядки цієї людини; без нього — усі торгові. */
  userId?: string;
  filter?: string | null;
  cursor?: string | null;
}): Promise<{ rows: FeedRowOut[]; nextCursor: string | null }> {
  const types = filterTypes(opts.filter);
  const cursor = parseCursor(opts.cursor);

  const where: Prisma.NotificationWhereInput = {
    ...(opts.userId ? { userId: opts.userId } : {}),
    type: types ? { in: types } : { startsWith: REP_FEED_PREFIX },
    ...(cursor
      ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] }
      : {}),
  };

  const found = await prisma.notification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: FEED_PAGE + 1,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      isRead: true,
      relatedId: true,
      createdAt: true,
      user: { select: { id: true, name: true } },
    },
  });

  const page = found.slice(0, FEED_PAGE);
  const last = page[page.length - 1];
  return {
    rows: page.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      isRead: n.isRead,
      relatedId: n.relatedId,
      createdAt: n.createdAt.toISOString(),
      rep: opts.userId ? null : { id: n.user.id, name: n.user.name.trim() },
    })),
    nextCursor: found.length > FEED_PAGE && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
  };
}

/**
 * Цифра біля «Стрічки подій» в меню адмінки: скільки подій з'явилось після
 * того, як керівник востаннє відкривав стрічку, і скільки їх за сьогодні.
 * Хто ще не відкривав жодного разу — нове рахується від початку дня.
 */
export async function feedCounts(seenAt: Date | null, dayStart: Date): Promise<{ unseen: number; today: number }> {
  const [today, unseen] = await Promise.all([
    prisma.notification.count({ where: { type: { startsWith: REP_FEED_PREFIX }, createdAt: { gte: dayStart } } }),
    prisma.notification.count({
      where: { type: { startsWith: REP_FEED_PREFIX }, createdAt: { gt: seenAt ?? dayStart } },
    }),
  ]);
  return { unseen, today };
}
