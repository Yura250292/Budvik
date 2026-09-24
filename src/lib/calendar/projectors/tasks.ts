/**
 * Задачі персоналу → події календаря.
 *
 * Проєктор — єдине місце, де конектор знає щось про предметну область.
 * Нижче по течії (дифф, рушій, клієнт Google) ніхто вже не знає, що таке
 * задача: там лише «бажані події». Тому додати нову сутність — це новий
 * файл поруч, а не правка рушія.
 *
 * Чисту частину навмисно відділено від запиту до бази: правила «що
 * показуємо» — найдорожче місце для помилки, і вони перевіряються пробою
 * без бази (scripts/check-calendar-projector.mts).
 *
 * Модуль без next/* — його збирає воркер.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";
import type { DesiredEvent } from "@/lib/calendar/types";
import type { SyncWindow } from "@/lib/calendar/policy";

export type TaskRow = {
  id: string;
  title: string;
  details: string | null;
  status: string;
  priority: string;
  dueAt: Date | null;
  counterpartyName: string | null;
};

/**
 * Які задачі бачить календар.
 *
 * Лише ASSIGNED: PROPOSED — це чернетка з наради, якої виконавець ще не
 * бачив, і показувати її як обіцянку було б брехнею. Без строку події теж
 * немає — календарю нічого робити з тим, у чого немає дати.
 */
export function taskEvents(rows: TaskRow[], window: Pick<SyncWindow, "from" | "to">): DesiredEvent[] {
  const events: DesiredEvent[] = [];

  for (const t of rows) {
    if (t.status !== "ASSIGNED" || !t.dueAt) continue;

    const day = kyivDate(t.dueAt);
    if (day < window.from || day > window.to) continue;

    const parts = [t.details?.trim(), t.counterpartyName ? `Клієнт: ${t.counterpartyName}` : null].filter(Boolean);

    events.push({
      entity: "STAFF_TASK",
      entityId: t.id,
      // Строк у базі — завжди кінець київської доби (23:59:59), тож подія на
      // весь день: ставити її на 23:59 означало б ховати задачу в кінці дня.
      summary: t.priority === "HIGH" ? `! ${t.title}` : t.title,
      description: parts.length > 0 ? parts.join("\n") : null,
      location: null,
      day,
      at: null,
      minutes: null,
    });
  }

  return events;
}

/** Задачі людини на вікні синхронізації. */
export async function taskEventsFor(userId: string, window: SyncWindow): Promise<DesiredEvent[]> {
  const rows = await prisma.staffTask.findMany({
    where: {
      assigneeId: userId,
      status: "ASSIGNED",
      dueAt: { gte: window.start, lte: window.end },
    },
    select: {
      id: true,
      title: true,
      details: true,
      status: true,
      priority: true,
      dueAt: true,
      counterparty: { select: { name: true } },
    },
  });

  return taskEvents(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      details: r.details,
      status: r.status,
      priority: r.priority,
      dueAt: r.dueAt,
      counterpartyName: r.counterparty?.name ?? null,
    })),
    window
  );
}
