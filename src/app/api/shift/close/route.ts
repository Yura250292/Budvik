/**
 * Закриття зміни: другий одометр перетворює її на пробіг.
 *
 * Тут же рахується звірка з GPS. Одометр більший за трек — норма (трек
 * іде по прямій між точками раз на хвилину, дорога довша). Тривожить
 * зворотне: коли кілометри в одометрі є, а треку до них немає.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { OdometerSource } from "@prisma/client";
import { verifyDeviceToken, TRACK_ROLES } from "@/lib/track/device-token";
import { findLastFinished, gpsDistanceForShift, summarize } from "@/lib/shift/service";
import { MAX_DAILY_KM } from "@/lib/odometer/validate";

export const dynamic = "force-dynamic";

const SOURCES: OdometerSource[] = ["AI", "MANUAL", "CORRECTED"];

export async function POST(req: NextRequest) {
  const userId = await resolveUser(req);
  if (!userId) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });

  let body: {
    readId?: string;
    odometer?: number;
    source?: string;
    lat?: number;
    lng?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  const odometer = Number(body.odometer);
  if (!Number.isInteger(odometer) || odometer < 100 || odometer > 2_000_000) {
    return NextResponse.json({ error: "Некоректні показання одометра" }, { status: 400 });
  }

  const source = (body.source ?? "AI").toUpperCase() as OdometerSource;
  if (!SOURCES.includes(source)) {
    return NextResponse.json({ error: "Некоректне джерело" }, { status: 400 });
  }

  const shift = await prisma.shift.findFirst({
    where: { userId, status: "OPEN" },
    orderBy: { startedAt: "desc" },
  });

  if (!shift) {
    // Повторне закриття після втраченої відповіді: віддаємо останню
    // закриту як успіх, щоб застосунок не застряг у циклі ретраїв.
    const last = await prisma.shift.findFirst({
      where: { userId, status: "CLOSED" },
      orderBy: { startedAt: "desc" },
    });
    if (last) return NextResponse.json({ shift: summarize(last), repeated: true });
    return NextResponse.json({ error: "Немає відкритої зміни" }, { status: 409 });
  }

  const readRow = body.readId
    ? await prisma.shiftOdometerRead.findUnique({
        where: { id: body.readId },
        select: { id: true, userId: true, photoUrl: true, photoKey: true, photoSha256: true, aiValue: true, aiConfidence: true },
      })
    : null;

  if (readRow && readRow.userId !== userId) {
    return NextResponse.json({ error: "Чуже розпізнавання" }, { status: 403 });
  }

  const endedAt = new Date();
  const distanceKm = odometer - shift.startOdometer;
  const durationMinutes = Math.round((endedAt.getTime() - shift.startedAt.getTime()) / 60_000);

  const gpsKm = await gpsDistanceForShift(shift.id);
  const ratio = gpsKm != null && gpsKm > 0 ? Math.round((distanceKm / gpsKm) * 100) / 100 : null;

  /**
   * Підозра — не вирок, а мітка «подивись». Від'ємний пробіг фізично
   * неможливий, нульовий означає, що машина не рухалась, а понад
   * MAX_DAILY_KM за день не проїде ніхто з розвозом по області.
   */
  const odometerSuspicious =
    distanceKm < 0 || distanceKm > MAX_DAILY_KM || (distanceKm === 0 && durationMinutes > 60);

  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: {
      status: "CLOSED",
      endedAt,
      endOdometer: odometer,
      endOdometerSource: source,
      endOdometerAiValue: readRow?.aiValue ?? null,
      endOdometerConfidence: readRow?.aiConfidence ?? null,
      endPhotoUrl: readRow?.photoUrl ?? null,
      endPhotoKey: readRow?.photoKey ?? null,
      endPhotoSha256: readRow?.photoSha256 ?? null,
      endConfirmedAt: endedAt,
      endLat: typeof body.lat === "number" ? body.lat : null,
      endLng: typeof body.lng === "number" ? body.lng : null,
      distanceKm: distanceKm >= 0 ? distanceKm : null,
      durationMinutes,
      gpsDistanceKm: gpsKm,
      odometerToGpsRatio: ratio,
      odometerSuspicious,
    },
  });

  if (readRow) {
    await prisma.shiftOdometerRead.update({
      where: { id: readRow.id },
      data: { shiftId: shift.id },
    });
  }

  // Попередня закрита зміна — щоб застосунок одразу показав «минулого
  // разу було стільки», без другого запиту.
  const previous = await findLastFinished(userId);

  return NextResponse.json({
    shift: summarize(updated),
    comparison: {
      distanceKm: updated.distanceKm,
      gpsDistanceKm: gpsKm,
      odometerToGpsRatio: ratio,
      previousDistanceKm: previous && previous.id !== updated.id ? previous.distanceKm : null,
    },
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
