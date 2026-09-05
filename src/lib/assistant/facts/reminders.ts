/**
 * Нагадування торгового: створити, показати, розіслати.
 *
 * Це єдине, що помічник ЗАПИСУЄ, крім пам'яті про клієнта, — і межа тут
 * проведена свідомо: нагадування нічого не змінює ні в цінах, ні в
 * залишках, ні в документах. Воно живе в своїй таблиці й впливає лише на
 * те, чи прийде пуш.
 *
 * Доставка — тим самим шляхом, що й рух у таблі: воркер раз на чверть
 * години дивиться, чому настав час, і шле пуш. Прострочені (воркер лежав,
 * телефон був офлайн) не губляться: беруться за notifiedAt IS NULL, а не
 * за «те, що настало саме зараз».
 */

import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push/send";

/** Наскільки пізно ще має сенс нагадувати про прострочене. */
const STALE_HOURS = 12;

export type ReminderRow = {
  id: string;
  text: string;
  dueAt: Date;
  counterpartyId: string | null;
  clientName: string | null;
};

export async function createReminder(input: {
  userId: string;
  text: string;
  dueAt: Date;
  counterpartyId?: string | null;
}) {
  return prisma.assistantReminder.create({
    data: {
      userId: input.userId,
      text: input.text.slice(0, 300),
      dueAt: input.dueAt,
      counterpartyId: input.counterpartyId ?? null,
    },
    select: { id: true, text: true, dueAt: true },
  });
}

/** Що попереду: незакриті нагадування, найближчі першими. */
export async function listReminders(userId: string, limit = 10): Promise<ReminderRow[]> {
  const rows = await prisma.assistantReminder.findMany({
    where: { userId, doneAt: null },
    orderBy: { dueAt: "asc" },
    take: limit,
    select: {
      id: true,
      text: true,
      dueAt: true,
      counterpartyId: true,
      counterparty: { select: { name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    dueAt: r.dueAt,
    counterpartyId: r.counterpartyId,
    clientName: r.counterparty?.name ?? null,
  }));
}

export type ReminderDelivery = { id: string; userId: string; text: string; sent: boolean };

/**
 * Розіслати те, чому настав час.
 *
 * `dry` нічого не шле й нічого не позначає — режим для перевірки перед
 * тим, як ставити це на воркер.
 */
export async function deliverDueReminders(opts: { dry?: boolean } = {}): Promise<ReminderDelivery[]> {
  const now = new Date();
  const due = await prisma.assistantReminder.findMany({
    where: {
      notifiedAt: null,
      doneAt: null,
      dueAt: { lte: now, gte: new Date(now.getTime() - STALE_HOURS * 3_600_000) },
    },
    take: 50,
    select: {
      id: true,
      userId: true,
      text: true,
      dueAt: true,
      counterparty: { select: { name: true } },
    },
  });

  const out: ReminderDelivery[] = [];

  for (const r of due) {
    if (!opts.dry) {
      await sendPushToUser(r.userId, {
        title: r.counterparty?.name ? `⏰ ${r.counterparty.name}` : "⏰ Нагадування",
        body: r.text,
        url: "/sales/assistant",
        data: { screen: "/cabinet", target: "/sales/assistant" },
      });
      await prisma.assistantReminder.update({
        where: { id: r.id },
        data: { notifiedAt: new Date() },
      });
    }
    out.push({ id: r.id, userId: r.userId, text: r.text, sent: !opts.dry });
  }

  /**
   * Те, що протухло, закриваємо мовчки.
   *
   * Нагадування «подзвонити о 9» о десятій вечора вже не потрібне, а на
   * ранок воно спрацювало б як свіже — і торговий отримав би пуш про
   * вчорашню справу.
   */
  if (!opts.dry) {
    await prisma.assistantReminder.updateMany({
      where: {
        notifiedAt: null,
        doneAt: null,
        dueAt: { lt: new Date(now.getTime() - STALE_HOURS * 3_600_000) },
      },
      data: { doneAt: now },
    });
  }

  return out;
}
