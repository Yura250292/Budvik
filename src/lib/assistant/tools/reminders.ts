/**
 * Нагадування для моделі.
 *
 * Швидкий шлях (router → answers) уже ставить нагадування сам і робить це
 * безкоштовно, але лише на звичних формулюваннях: «нагадай завтра», «у
 * пʼятницю», «через тиждень». Коли торговий каже інакше — «набери мені в
 * понеділок після обіду, бо він до обіду не бере слухавку» — правила
 * мовчать, і без цього інструмента модель відповіла б «не вмію».
 *
 * Час рахує МОДЕЛЬ і передає готовим: у контексті ходу є сьогоднішня дата,
 * а розбирати «після обіду наступного вівторка» правилами — це писати
 * другий календар.
 */

import type { ToolDef } from "@/lib/assistant/types";
import { id as validId, str } from "@/lib/assistant/validate";
import { prisma } from "@/lib/prisma";
import { createReminder, listReminders } from "@/lib/assistant/facts/reminders";
import { kyivDayStart } from "@/lib/date/kyiv";

/** Далі року вперед нагадування не ставимо: це вже не нагадування. */
const MAX_AHEAD_MS = 365 * 86_400_000;

export const remindMe: ToolDef = {
  kinds: ["SALES", "DRIVER"],
  name: "remind_me",
  label: "Ставлю нагадування",
  write: true,
  description:
    "Поставити нагадування: у вказаний час на телефон прийде пуш. Викликай, коли просять «нагадай», «не дай забути», «набери мені». Час рахуй сам від сьогоднішньої дати з контексту й передавай київський, у форматі 2026-09-12T09:00. Нічого, крім нагадування, це не змінює.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "Про що нагадати, коротко й словами торгового." },
      when: { type: "string", description: "Київські дата й час: 2026-09-12T09:00." },
      counterpartyId: {
        type: "string",
        description: "Ідентифікатор клієнта, якщо нагадування про нього. Без нього — просто справа.",
      },
    },
    required: ["text", "when"],
  },
  async run(ctx, args) {
    const text = str(args.text, "text", { min: 3, max: 300 });
    const when = str(args.when, "when", { min: 10, max: 25 });

    const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2}))?$/.exec(when.trim());
    if (!match) return { помилка: "час треба у форматі 2026-09-12T09:00" };

    const [, day, hh, mm] = match;
    const at = new Date(
      kyivDayStart(day).getTime() + Number(hh ?? 9) * 3_600_000 + Number(mm ?? 0) * 60_000
    );
    if (Number.isNaN(at.getTime())) return { помилка: "не розібрав дату" };
    if (at.getTime() < Date.now() - 60_000) return { помилка: "цей час уже минув" };
    if (at.getTime() > Date.now() + MAX_AHEAD_MS) return { помилка: "занадто далеко вперед" };

    let counterpartyId: string | null = null;
    if (typeof args.counterpartyId === "string" && args.counterpartyId.trim()) {
      counterpartyId = validId(args.counterpartyId, "counterpartyId");
      const exists = await prisma.counterparty.findUnique({
        where: { id: counterpartyId },
        select: { id: true },
      });
      if (!exists) return { помилка: "клієнта з таким ідентифікатором немає" };
    }

    const saved = await createReminder({
      userId: ctx.scope.repId,
      text,
      dueAt: at,
      counterpartyId,
    });

    return {
      ok: true,
      нагадування: { id: saved.id, текст: saved.text, коли: at.toISOString() },
      повідомлення: "Поставив. Пуш прийде на телефон.",
    };
  },
};

export const myReminders: ToolDef = {
  kinds: ["SALES", "DRIVER"],
  name: "my_reminders",
  label: "Дивлюся нагадування",
  description: "Незакриті нагадування торгового: коли, про що і про якого клієнта.",
  parameters: { type: "object", properties: {} },
  async run(ctx) {
    const list = await listReminders(ctx.scope.repId, 15);
    return {
      всього: list.length,
      нагадування: list.map((r) => ({
        клієнт_id: r.counterpartyId,
        клієнт: r.clientName,
        текст: r.text,
        коли: r.dueAt.toISOString(),
      })),
    };
  },
};
