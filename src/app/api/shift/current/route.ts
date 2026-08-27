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
          shouldRemindToClose: hoursOpen != null && hoursOpen >= ABANDON_AFTER_HOURS - 4,
        }
      : null,
    previous: previous
      ? {
          endOdometer: previous.endOdometer,
          endedAt: previous.endedAt,
          distanceKm: previous.distanceKm,
        }
      : null,
  });
}

