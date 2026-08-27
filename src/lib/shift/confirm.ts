/**
 * Звірка зміни, закритої без фінішного фото: спільні правила для всіх.
 *
 * Підтверджують двоє — торговий у застосунку й офіс в адмінці, — і
 * перевірки в них однакові: одометр не може бути меншим за стартовий і
 * більшим за старт наступної зміни, час не може випадати за межі
 * сусідніх змін. Якби ці межі жили в кожному роуті окремо, одна зі
 * сторін рано чи пізно пропустила б описку, яку інша ловить.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { applyEndOdometer, nextShiftOf } from "@/lib/shift/reconcile";

/**
 * Скільки годин після автозакриття зміну ще можна повернути в роботу.
 *
 * Три години покривають реальний випадок «система закрила о 20:00, а я
 * ще на клієнті», але не дають наступного дня переписати вчорашній
 * день заднім числом.
 */
export const REOPEN_WINDOW_HOURS = 3;

export type ConfirmInput = {
  /** Кінцевий одометр, якщо людина його називає */
  endOdometer?: number;
  /** Виправлений час закінчення роботи */
  endedAt?: Date;
};

export type ConfirmResult =
  | { ok: true; shift: Awaited<ReturnType<typeof loadForConfirm>> }
  | { ok: false; status: number; error: string };

/** Поля, потрібні для звірки. Один select на обидва роути. */
export async function loadForConfirm(shiftId: string) {
  return prisma.shift.findUnique({
    where: { id: shiftId },
    select: {
      id: true,
      userId: true,
      status: true,
      startedAt: true,
      endedAt: true,
      startOdometer: true,
      endOdometer: true,
      distanceKm: true,
      gpsDistanceKm: true,
      afterWorkKm: true,
      closedLate: true,
      closedAutomatically: true,
      lateCloseSource: true,
      confirmedAt: true,
      confirmSource: true,
    },
  });
}

type ShiftRow = NonNullable<Awaited<ReturnType<typeof loadForConfirm>>>;

/**
 * Перевіряє межі й записує звірку.
 *
 * `by` — хто підтверджує: сам торговий (REP) чи офіс (OFFICE). Різниця
 * лише в підписі: правила для обох однакові, бо помиляються обидва.
 */
export async function confirmShift(
  shift: ShiftRow,
  input: ConfirmInput,
  by: { userId: string; source: "REP" | "OFFICE" }
): Promise<ConfirmResult> {
  const next = await nextShiftOf(shift.userId, shift.startedAt);

  const endedAt = input.endedAt;
  if (endedAt) {
    if (endedAt <= shift.startedAt) {
      return { ok: false, status: 400, error: "Час закінчення раніший за початок зміни" };
    }
    if (endedAt.getTime() > Date.now() + 60_000) {
      return { ok: false, status: 400, error: "Час закінчення в майбутньому" };
    }
    if (next && endedAt > next.startedAt) {
      return { ok: false, status: 400, error: "Час закінчення пізніший за початок наступної зміни" };
    }
  }

  const endOdometer = input.endOdometer;
  if (endOdometer != null) {
    if (!Number.isInteger(endOdometer) || endOdometer < 100 || endOdometer > 2_000_000) {
      return { ok: false, status: 400, error: "Некоректні показання одометра" };
    }
    if (endOdometer < shift.startOdometer) {
      return {
        ok: false,
        status: 400,
        error: `Одометр менший за стартовий (${shift.startOdometer} км)`,
      };
    }
    /**
     * Стеля — старт наступної зміни. Одометр між змінами тільки росте,
     * тож більше число означає описку в одному з двох місць, і краще
     * зупинити людину тут, ніж рахувати зарплату по обох.
     */
    if (next && endOdometer > next.startOdometer) {
      return {
        ok: false,
        status: 400,
        error: `Одометр більший за старт наступної зміни (${next.startOdometer} км)`,
      };
    }
  }

  const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (endOdometer != null) {
      await applyEndOdometer(tx, shift, {
        endOdometer,
        endedAt,
        // Число назвала людина, а не розпізнавання з фото — саме це й
        // означає CORRECTED у джерелах одометра.
        source: "CORRECTED",
      });
    } else if (endedAt) {
      await tx.shift.update({
        where: { id: shift.id },
        data: {
          endedAt,
          durationMinutes: Math.round((endedAt.getTime() - shift.startedAt.getTime()) / 60_000),
        },
      });
    }

    await tx.shift.update({
      where: { id: shift.id },
      data: {
        confirmedAt: new Date(),
        confirmedById: by.userId,
        confirmSource: by.source,
      },
    });

    return loadForConfirm(shift.id);
  });

  return { ok: true, shift: updated };
}
