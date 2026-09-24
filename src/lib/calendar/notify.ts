/**
 * «Календар відпав» — одне повідомлення на добу, не більше.
 *
 * Дозвіл Google перестає діяти сам собою: людина змінила пароль, забрала
 * доступ у налаштуваннях акаунта, або Google вирішив, що пора. Це стан, а
 * не аварія, і поводитись із ним треба відповідно — сказати один раз і
 * чекати, а не нагадувати щодві хвилини.
 *
 * Унікальність dedupKey тут і є замком від повторів — рівно як у стрічці
 * торгового (src/lib/rep-feed) і в задачах (src/lib/tasks/notify.ts).
 *
 * Модуль без next/* — його збирає воркер.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push/send";
import { inPushHours } from "@/lib/rep-feed/format";
import { kyivDate } from "@/lib/date/kyiv";

const TITLE = "Календар Google відключився";
const BODY = "Доступ до календаря відпав. Зайдіть у профіль і підключіть ще раз — інакше робочий день не оновлюється.";

export async function notifyReconnect(userId: string, now: Date = new Date()): Promise<boolean> {
  const dedupKey = `CALENDAR_RECONNECT:${userId}:${kyivDate(now)}`;

  let notificationId: string | null = null;
  try {
    const row = await prisma.notification.create({
      data: { userId, type: "CALENDAR_RECONNECT", title: TITLE, body: BODY, dedupKey },
      select: { id: true },
    });
    notificationId = row.id;
  } catch (e) {
    // Уже казали сьогодні — другого разу не треба.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }

  // Уночі не будимо: справа терпить до ранку.
  if (!inPushHours(now)) return true;

  await sendPushToUser(userId, { title: TITLE, body: BODY });
  await prisma.notification
    .update({ where: { id: notificationId }, data: { pushedAt: now } })
    .catch(() => {});
  return true;
}
