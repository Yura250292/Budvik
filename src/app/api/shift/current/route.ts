/**
 * Стан зміни для застосунку.
 *
 * Джерело істини — сервер, а не пам'ять телефона. Планшет можуть
 * перезавантажити, застосунок — переставити, зміну міг закрити адмін.
 * Після кожного такого випадку застосунок мусить дізнатися правду, а не
 * малювати «зміна відкрита» з локального кешу.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";
import { findLastFinished, gpsDistanceForShift, summarize, ABANDON_AFTER_HOURS } from "@/lib/shift/service";
import { REOPEN_WINDOW_HOURS } from "@/lib/shift/confirm";
import { kyivHour } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;
  const userId = auth.me.userId;

  const open = await prisma.shift.findFirst({
    where: { userId, status: "OPEN" },
    orderBy: { startedAt: "desc" },
  });

  const previous = await findLastFinished(userId);

  /**
   * Зміна, закрита не самою людиною, чекає її слова.
   *
   * Питання тут одне: «вчора система закрила твою зміну о 19:53 —
   * так було?». Поки на нього не відповіли, цифри в зарплаті стоять на
   * здогадці треку, а не на чиємусь підтвердженні. Тому картка висить у
   * застосунку доти, доки торговий її не закриє — підтвердженням,
   * одометром або поверненням зміни в роботу.
   */
  const pending = await prisma.shift.findFirst({
    where: {
      userId,
      status: { in: ["ABANDONED", "CLOSED"] },
      closedLate: true,
      confirmedAt: null,
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      startOdometer: true,
      endOdometer: true,
      distanceKm: true,
      gpsDistanceKm: true,
      afterWorkKm: true,
      lateCloseSource: true,
      closedAutomatically: true,
    },
  });

  const gpsKm = open ? await gpsDistanceForShift(open.id) : null;
  const hoursOpen = open
    ? Math.round(((Date.now() - open.startedAt.getTime()) / 3_600_000) * 10) / 10
    : null;

  return NextResponse.json({
    // Серверний час: годинник планшета може збігтися, і тоді розрахунок
    // «скільки триває зміна» на пристрої брехав би.
    serverTime: new Date().toISOString(),
    shift: open
      ? {
          ...summarize(open),
          gpsDistanceKm: gpsKm,
          hoursOpen,
          // Підказка застосунку: час нагадати про закриття, поки зміну
          // не визнали забутою.
          /**
           * Час нагадати про закриття.
           *
           * Раніше підказка з'являлася лише на шістнадцятій годині
           * зміни — тобто вже вночі, коли робити з нею нічого. Тепер
           * вона вмикається ввечері робочого дня: саме тоді людина ще
           * пам'ятає, о котрій закінчила, і може закрити зміну сама,
           * не чекаючи, поки це зробить сервер.
           */
          shouldRemindToClose:
            hoursOpen != null &&
            ((hoursOpen >= 3 && kyivHour(new Date()) >= 19) ||
              hoursOpen >= ABANDON_AFTER_HOURS - 4),
        }
      : null,
    previous: previous
      ? {
          endOdometer: previous.endOdometer,
          endedAt: previous.endedAt,
          distanceKm: previous.distanceKm,
        }
      : null,
    /**
     * Картку показуємо й тоді, коли нова зміна вже відкрита.
     *
     * Це не перешкода, а найкращий момент: саме ранкове фото добило
     * вчорашній одометр, і число, яке треба підтвердити, щойно
     * з'явилося. Якщо ховати картку до вечора, торговий побачить її
     * тоді, коли вже не пам'ятає, о котрій закінчив.
     */
    needsConfirmation:
      pending
        ? {
            shiftId: pending.id,
            startedAt: pending.startedAt,
            endedAt: pending.endedAt,
            startOdometer: pending.startOdometer,
            endOdometer: pending.endOdometer,
            distanceKm: pending.distanceKm,
            gpsDistanceKm: pending.gpsDistanceKm,
            afterWorkKm: pending.afterWorkKm,
            lateCloseSource: pending.lateCloseSource,
            closedAutomatically: pending.closedAutomatically,
            /**
             * Повернути зміну в роботу можна лише в перші години й лише
             * якщо закрив її автомат: після ранкового фото одометр уже
             * порахований, а виправляти чуже рішення людині нема чого —
             * своє вона й так може змінити одометром.
             */
            canReopen:
              pending.closedAutomatically &&
              pending.endOdometer == null &&
              pending.endedAt != null &&
              Date.now() - pending.endedAt.getTime() <= REOPEN_WINDOW_HOURS * 3_600_000,
          }
        : null,
  });
}

