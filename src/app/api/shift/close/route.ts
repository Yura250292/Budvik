/**
 * Закриття зміни: другий одометр перетворює її на пробіг.
 *
 * Тут же рахується звірка з GPS. Одометр більший за трек — норма (трек
 * іде по прямій між точками раз на хвилину, дорога довша). Тривожить
 * зворотне: коли кілометри в одометрі є, а треку до них немає.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { OdometerSource } from "@prisma/client";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";
import {
  findLastFinished,
  computeShiftTrackFields,
  isOdometerSuspicious,
  summarize,
} from "@/lib/shift/service";
import { notifyShiftClosed } from "@/lib/shift/telegram-report";
import { afterResponse } from "@/lib/http/after-response";

export const dynamic = "force-dynamic";

const SOURCES: OdometerSource[] = ["AI", "MANUAL", "CORRECTED"];

export async function POST(req: NextRequest) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;
  const userId = auth.me.userId;

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

  /**
   * Трек рахуємо вже з новим часом закінчення: `endedAt` щойно проставлено,
   * і саме він відділяє робочі кілометри від вечірніх.
   */
  const track = await computeShiftTrackFields({ ...shift, endedAt });
  const gpsKm = track.driveKm;
  const ratio = gpsKm != null && gpsKm > 0 ? Math.round((distanceKm / gpsKm) * 100) / 100 : null;

  /**
   * Підозра — не вирок, а мітка «подивись». Правило спільне з трьома
   * іншими шляхами закриття (`isOdometerSuspicious`), щоб однакові зміни
   * не позначалися по-різному залежно від того, ЯК їх закрили.
   */
  const pointsCount = await prisma.trackPoint.count({ where: { shiftId: shift.id } });
  const odometerSuspicious = isOdometerSuspicious({
    distanceKm,
    durationMinutes,
    trackDriveKm: track.driveKm,
    // Трек цілий, якщо він дожив до закриття: людина фотографує одометр у
    // ту саму мить, тож свіжість перевіряти нема потреби — досить обсягу.
    trackComplete: pointsCount >= 100,
  });

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
      ...track,
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

  // Звіт офісу — після відповіді (див. пояснення в open/route.ts). Сюди
  // не потрапляє повторне закриття: воно віддає відповідь вище.
  afterResponse(() => notifyShiftClosed(updated.id));

  // Попередня закрита зміна — щоб застосунок одразу показав «минулого
  // разу було стільки», без другого запиту.
  const previous = await findLastFinished(userId);

  /**
   * Сказати людині, поки вона ще в машині.
   *
   * Ручне введення не проходить через розпізнавання, тобто повз усі
   * перевірки: діапазон — і все. Саме цим шляхом ідуть найдорожчі описки.
   * 03.09 Джумага закрив дев'ятигодинну зміну з різницею 18 км при 94 км за
   * треком, 26.08 — 468 км при 105. Обидва числа правдоподібні самі по
   * собі й неправдоподібні поруч із маршрутом.
   *
   * Не блокуємо: трек — здогадка, а зміну закрити треба завжди. Але мовчати
   * теж не можна: за годину людина вже не згадає, що було на табло.
   */
  const trackWarning =
    odometerSuspicious && gpsKm != null && gpsKm > 5 && distanceKm >= 0 && pointsCount >= 100
      ? `За маршрутом виходить ${gpsKm} км, а за одометром ${distanceKm} км. ` +
        `Перевірте показання — офіс уточнить.`
      : null;

  return NextResponse.json({
    warning: trackWarning,
    shift: summarize(updated),
    comparison: {
      distanceKm: updated.distanceKm,
      gpsDistanceKm: gpsKm,
      odometerToGpsRatio: ratio,
      previousDistanceKm: previous && previous.id !== updated.id ? previous.distanceKm : null,
    },
  });
}

