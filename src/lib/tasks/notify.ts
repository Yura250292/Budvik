/**
 * Доставка задач: рядок у стрічці й пуш — виконавцю про нову, автору про виконану.
 *
 * Кличе воркер на кожному тіку нарад, а не роут у момент натискання. Так
 * само, як нагадування помічника (assistant/facts/reminders.ts): пуш іде в
 * робочі години, рядок у стрічці з'являється одразу, а перезапуск чи недоступний
 * Expo нічого не губить — тік просто спробує ще раз.
 *
 * Денна стеля стрічки торгового (8 пушів) задач не стосується: це свідома дія
 * керівника, а не автоматична подія, яку можна пропустити.
 *
 * Модуль без next/* — його збирає воркер.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push/send";
import { inPushHours, shortName } from "@/lib/rep-feed/format";
import { isPushMuted, parsePushPrefs } from "@/lib/rep-feed/prefs";
import { REP_FEED_TYPES } from "@/lib/rep-feed/types";

const BATCH = 50;

/**
 * Куди веде пуш у робочій збірці.
 *
 * Білий список тапів (mobile/src/track/notification-taps.ts, CABINET_TARGET)
 * пропускає лише /sales, /driver і /warehouse — адмінку пуш відкрити не
 * вміє, тож офісу шлемо без цілі: застосунок просто відкриється.
 */
function targetFor(role: string): string | null {
  if (role === "SALES") return "/sales/tasks";
  if (role === "DRIVER") return "/driver/tasks";
  if (role === "WAREHOUSE") return "/warehouse/tasks";
  return null;
}

const DAY_MONTH = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit" });

/** Рядок у стрічці; вже є — повертаємо його id. */
async function ensureNotification(data: {
  userId: string;
  type: string;
  title: string;
  body: string;
  relatedId: string;
  dedupKey: string;
}): Promise<string | null> {
  try {
    const n = await prisma.notification.create({ data, select: { id: true } });
    return n.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const n = await prisma.notification.findUnique({ where: { dedupKey: data.dedupKey }, select: { id: true } });
      return n?.id ?? null;
    }
    throw e;
  }
}

export async function deliverTaskNotifications(opts: { dry?: boolean; now?: Date } = {}): Promise<string[]> {
  const now = opts.now ?? new Date();
  const inHours = inPushHours(now);
  const log: string[] = [];

  /* Нові задачі виконавцям. */
  const assigned = await prisma.staffTask.findMany({
    where: { status: "ASSIGNED", pushedAt: null, assigneeId: { not: null } },
    orderBy: { sentAt: "asc" },
    take: BATCH,
    include: {
      assignee: { select: { id: true, name: true, role: true, notificationPrefs: true } },
      counterparty: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });

  for (const t of assigned) {
    if (!t.assignee) continue;
    const title = `Задача від ${shortName(t.createdBy.name, 28)}`;
    const body = [
      shortName(t.title, 90),
      t.counterparty ? shortName(t.counterparty.name, 32) : null,
      t.dueAt ? `до ${DAY_MONTH.format(t.dueAt)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const muted = isPushMuted(parsePushPrefs(t.assignee.notificationPrefs), REP_FEED_TYPES.TASK);

    if (opts.dry) {
      log.push(`${t.assignee.name}: ${body} — ${muted ? "лише стрічка (вимкнено)" : inHours ? "пуш" : "пуш о 08:00"}`);
      continue;
    }

    const sentKey = (t.sentAt ?? t.createdAt).getTime();
    const notificationId = await ensureNotification({
      userId: t.assignee.id,
      type: REP_FEED_TYPES.TASK,
      title,
      body,
      relatedId: t.id,
      dedupKey: `${REP_FEED_TYPES.TASK}:${t.id}:${sentKey}`,
    });

    // Поза робочими годинами рядок у стрічці вже є, пуш — на наступному тіку в години.
    if (!muted && !inHours) continue;

    // Захоплення перед відправкою: дві копії воркера не мають штовхнути двічі.
    const claimed = await prisma.staffTask.updateMany({
      where: { id: t.id, status: "ASSIGNED", pushedAt: null, assigneeId: t.assignee.id },
      data: { pushedAt: now },
    });
    if (claimed.count !== 1 || muted) continue;

    const target = targetFor(t.assignee.role);
    await sendPushToUser(t.assignee.id, {
      title,
      body,
      urgent: true,
      ...(target ? { data: { screen: "/cabinet", target } } : {}),
    });
    if (notificationId) {
      await prisma.notification.update({ where: { id: notificationId }, data: { pushedAt: now } }).catch(() => {});
    }
    log.push(`задача → ${t.assignee.name}: ${t.title}`);
  }

  /* Виконані — тому, хто доручив. */
  const done = await prisma.staffTask.findMany({
    where: { status: "DONE", doneNotifiedAt: null },
    orderBy: { doneAt: "asc" },
    take: BATCH,
    include: {
      assignee: { select: { name: true } },
      counterparty: { select: { name: true } },
      createdBy: { select: { id: true, role: true } },
    },
  });

  for (const t of done) {
    const who = t.assignee?.name.trim() ?? "Виконавець";
    const title = `Виконано: ${shortName(t.title, 70)}`;
    const body = [who, t.counterparty ? shortName(t.counterparty.name, 32) : null, t.doneNote ? shortName(t.doneNote, 120) : null]
      .filter(Boolean)
      .join(" · ");

    if (opts.dry) {
      log.push(`виконано → автору: ${t.title} — ${inHours ? "пуш" : "пуш о 08:00"}`);
      continue;
    }

    const notificationId = await ensureNotification({
      userId: t.createdBy.id,
      type: REP_FEED_TYPES.TASK_DONE,
      title,
      body,
      relatedId: t.id,
      dedupKey: `${REP_FEED_TYPES.TASK_DONE}:${t.id}:${(t.doneAt ?? now).getTime()}`,
    });
    if (!inHours) continue;

    const claimed = await prisma.staffTask.updateMany({
      where: { id: t.id, status: "DONE", doneNotifiedAt: null },
      data: { doneNotifiedAt: now },
    });
    if (claimed.count !== 1) continue;

    const target = targetFor(t.createdBy.role);
    await sendPushToUser(t.createdBy.id, { title, body, ...(target ? { data: { screen: "/cabinet", target } } : {}) });
    if (notificationId) {
      await prisma.notification.update({ where: { id: notificationId }, data: { pushedAt: now } }).catch(() => {});
    }
    log.push(`виконано → ${t.createdBy.id}: ${t.title}`);
  }

  return log;
}
