/**
 * Стан зміни для застосунку.
 *
 * Джерело істини — сервер, а не пам'ять телефона. Планшет можуть
 * перезавантажити, застосунок — переставити, зміну міг закрити адмін.
 * Після кожного такого випадку застосунок мусить дізнатися правду, а не
 * малювати «зміна відкрита» з локального кешу.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyDeviceToken, TRACK_ROLES } from "@/lib/track/device-token";
import { findLastFinished, gpsDistanceForShift, summarize, ABANDON_AFTER_HOURS } from "@/lib/shift/service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const userId = await resolveUser(req);
  if (!userId) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });

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

async function resolveUser(req: NextRequest): Promise<string | null> {
  const device = await verifyDeviceToken(req.headers.get("authorization"));
  if (device) return device.userId;
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  if (!TRACK_ROLES.includes(session.user.role)) return null;
  return session.user.id;
}
