/**
 * Закриття зміни заднім числом — без фінішного фото.
 *
 * Коли це потрібно: торговий згадав про незакриту зміну ввечері вдома.
 * Машина у дворі, на одометрі вже інше число — у ньому дорога додому й
 * поїздка в магазин. Сфотографувати «як було о 17:00» неможливо.
 *
 * Що робимо: фіксуємо ЧАС закінчення роботи, поки людина його пам'ятає.
 * Одометр лишається невідомим і прийде зранку зі старту наступної зміни
 * — але завдяки часу вечірні кілометри вже відділяться від робочих за
 * GPS. Без цього кроку весь вечір ліг би в робочий пробіг.
 *
 * GET віддає підказку (коли машина стала надовго), POST закриває.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";
import { guessWorkEnd, gpsKmBetween } from "@/lib/shift/late-close";
import { autoCloseNote, closeWithoutPhoto } from "@/lib/shift/reconcile";

export const dynamic = "force-dynamic";

/** GET: що застосунок покаже як пропозицію. */
export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;
  const userId = auth.me.userId;

  const shift = await prisma.shift.findFirst({
    where: { userId, status: "OPEN" },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true, startOdometer: true },
  });

  if (!shift) return NextResponse.json({ error: "Немає відкритої зміни" }, { status: 409 });

  const guess = await guessWorkEnd(shift.id);

  return NextResponse.json({
    shift: { id: shift.id, startedAt: shift.startedAt, startOdometer: shift.startOdometer },
    // null, якщо треку замало — тоді застосунок просто попросить указати
    // час руками, без підказки.
    suggestion: guess
      ? {
          endedAt: guess.at,
          stoodMinutes: guess.minutes,
          workKm: await gpsKmBetween(shift.id, shift.startedAt, guess.at),
          afterWorkKm: await gpsKmBetween(shift.id, guess.at, null),
        }
      : null,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;
  const userId = auth.me.userId;

  let body: { endedAt?: string; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  const shift = await prisma.shift.findFirst({
    where: { userId, status: "OPEN" },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true, startOdometer: true },
  });

  if (!shift) {
    return NextResponse.json({ error: "Немає відкритої зміни" }, { status: 409 });
  }

  const endedAt = new Date(body.endedAt ?? "");
  if (Number.isNaN(endedAt.getTime())) {
    return NextResponse.json({ error: "Некоректний час закінчення" }, { status: 400 });
  }

  // Час має бути між початком зміни й «зараз»: закінчити роботу до того,
  // як вийшов, або в майбутньому — неможливо.
  if (endedAt <= shift.startedAt) {
    return NextResponse.json(
      { error: "Час закінчення раніший за початок зміни" },
      { status: 400 }
    );
  }
  if (endedAt.getTime() > Date.now() + 60_000) {
    return NextResponse.json({ error: "Час закінчення в майбутньому" }, { status: 400 });
  }

  /**
   * Запис — спільний з автозакриттям і правкою офісу
   * (`@/lib/shift/reconcile`). Тут лишається тільки рішення «чи можна
   * закрити цим часом», бо воно в кожного шляху своє.
   */
  const source = body.source === "GPS" ? "GPS" : "MANUAL";
  const updated = await prisma.$transaction((tx) =>
    closeWithoutPhoto(tx, shift, { endedAt, source, notes: autoCloseNote(source, null) })
  );

  return NextResponse.json({
    // Форма відповіді незмінна: на неї спирається екран пізнього
    // закриття в застосунку.
    shift: {
      id: updated.id,
      endedAt: updated.endedAt,
      durationMinutes: updated.durationMinutes,
      gpsDistanceKm: updated.gpsDistanceKm,
      afterWorkKm: updated.afterWorkKm,
    },
    note:
      "Зміну закрито. Пробіг за одометром порахується зранку, коли ви " +
      "сфотографуєте одометр на початку наступної зміни.",
  });
}

