/**
 * Прийом пачки точок веб-треку з планшета.
 *
 * Планшет шле не кожну точку окремо, а пачкою раз на ~25 секунд: у селі
 * зв'язок рветься, і поточечна відправка втрачала б трек. Тому ендпоінт
 * мусить бути ідемпотентним — пачка після таймауту приходить удруге, і
 * її точки відсіюються як stale (див. preparePoints).
 *
 * Сесія знаходиться сама за парою (користувач, київська доба): планшет
 * не тримає жодного ідентифікатора поїздки, який міг би протухнути за
 * ніч або розійтися між вкладками.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { preparePoints, type RawPoint } from "@/lib/track/geo";
import { findGaps, resolveGaps } from "@/lib/track/gaps";
import { verifyDeviceToken, TRACK_ROLES } from "@/lib/track/device-token";

export const dynamic = "force-dynamic";

/** Хто возить планшет. Решті ролей трек ні до чого. */
const ALLOWED_ROLES = TRACK_ROLES;

/** Стеля на пачку: більше — це вже не буфер, а спроба залити історію. */
const MAX_BATCH = 500;

export async function POST(req: NextRequest) {
  /**
   * Два способи входу в один ендпоінт: cookie для веб-планшета в
   * браузері й Bearer-токен для нативного застосунку. Токен перевіряємо
   * першим — у застосунку cookie немає взагалі, і зайвий getServerSession
   * на кожній пачці нічого б не дав.
   */
  const device = await verifyDeviceToken(req.headers.get("authorization"));

  let userId: string;
  if (device) {
    userId = device.userId;
  } else {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
    }
    if (!ALLOWED_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
    }
    userId = session.user.id;
  }

  let body: { points?: RawPoint[]; phase?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  const raw = Array.isArray(body.points) ? body.points : [];
  if (raw.length === 0) {
    return NextResponse.json({ error: "Порожня пачка" }, { status: 400 });
  }
  if (raw.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Забагато точок у пачці (максимум ${MAX_BATCH})` },
      { status: 400 }
    );
  }

  // Доба визначається за часом ПРИЙОМУ, а не за recordedAt точок: пачка,
  // надіслана о 00:05 після офлайну, все одно належить робочому дню, який
  // щойно закінчився... але планшет о 00:05 уже не в машині. Тому беремо
  // добу першої точки пачки — вона завжди з правильного дня.
  //
  // Час першої точки перевіряємо окремо: без цього крива пачка (null
  // замість об'єкта, сміття в recordedAt) валила б upsert по ключу
  // userId_day і поверталася б як 500 замість зрозумілого 400.
  const firstAt = new Date(raw[0]?.recordedAt ?? NaN);
  if (Number.isNaN(firstAt.getTime())) {
    return NextResponse.json(
      { error: "Перша точка пачки без коректного recordedAt" },
      { status: 400 }
    );
  }
  const day = kyivDate(firstAt);
  const dayStart = kyivDayStart(day);

  const sessionRow = await prisma.trackSession.upsert({
    where: { userId_day: { userId, day: dayStart } },
    create: { userId, day: dayStart },
    update: {},
    select: { id: true, distanceKm: true, pointsCount: true },
  });

  /**
   * До якої зміни належить пачка.
   *
   * Визначаємо на сервері, а не віримо пристрою: застосунок міг не
   * знати, що зміну закрив адмін, і клеїв би точки до закритої.
   * Пристрій лише каже, у якому режимі він їх зібрав.
   *
   * AFTER_SHIFT чіпляється до ОСТАННЬОЇ закритої зміни — так «чи не
   * таксував після роботи» видно поруч із самою зміною, а не окремим
   * безхазяйним треком.
   */
  const wantsAfterShift = String(body.phase ?? "").toUpperCase() === "AFTER_SHIFT";

  const openShift = wantsAfterShift
    ? null
    : await prisma.shift.findFirst({
        where: { userId, status: "OPEN" },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });

  const afterShift = wantsAfterShift
    ? await prisma.shift.findFirst({
        where: { userId, status: { in: ["CLOSED", "ABANDONED"] } },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      })
    : null;

  const shiftId = openShift?.id ?? afterShift?.id ?? null;
  // Фаза лише там, де зміна відома: старий трек водіїв про зміни нічого
  // не знає, і мітити його не можна.
  const phase = shiftId ? (openShift ? "SHIFT" : "AFTER_SHIFT") : null;

  // Остання точка дня — точка відліку для metersFromPrev. Без неї кожна
  // пачка починалася б «з нуля» і пробіг занижувався на розрив між ними.
  const last = await prisma.trackPoint.findFirst({
    where: { sessionId: sessionRow.id },
    orderBy: { recordedAt: "desc" },
    select: { lat: true, lng: true, recordedAt: true },
  });

  const prepared = preparePoints(raw, last);

  if (prepared.points.length === 0) {
    return NextResponse.json({
      accepted: 0,
      rejected: prepared.rejected,
      // Округлення таке саме, як у гілці з прийнятими точками: інакше
      // цифра на планшеті стрибала б між 5.3 і 5.307576 залежно від того,
      // чи прийнялася остання пачка.
      sessionDistanceKm: Math.round(sessionRow.distanceKm * 10) / 10,
      pointsCount: sessionRow.pointsCount,
    });
  }

  /**
   * Розриви (планшет був офлайн) добираємо реальною дорогою: пряма між
   * двома точками з різних кінців міста коротша за проїзд і занижує
   * пробіг. OSRM повільний, тому чекаємо його ДО транзакції й лише коли
   * розриви справді є — на щільному треку цей код не виконується взагалі.
   */
  const gaps = findGaps(prepared.points, last);
  const resolved = gaps.length > 0 ? await resolveGaps(gaps) : [];
  const byIndex = new Map(resolved.map((r) => [r.index, r]));

  // Пробіг: замість хорди — довжина дорогою там, де її вдалося дістати.
  const gapCorrectionM = resolved.reduce(
    (sum, r) => sum + (r.roadM != null ? r.roadM - r.straightM : 0),
    0
  );

  const [, updated] = await prisma.$transaction([
    prisma.trackPoint.createMany({
      data: prepared.points.map((p, i) => ({
        sessionId: sessionRow.id,
        userId,
        shiftId,
        phase,
        lat: p.lat,
        lng: p.lng,
        accuracyM: p.accuracyM,
        speedKmh: p.speedKmh,
        headingDeg: p.headingDeg,
        recordedAt: p.recordedAt,
        metersFromPrev: p.metersFromPrev,
        minutesFromPrev: p.minutesFromPrev,
        roadMetersFromPrev:
          byIndex.get(i)?.roadM != null ? Math.round(byIndex.get(i)!.roadM!) : null,
        // Тип GeoJSON не збігається з InputJsonValue Prisma (немає індексної
        // сигнатури), хоча по суті це той самий об'єкт.
        gapGeometry: (byIndex.get(i)?.geometry ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
      })),
    }),
    prisma.trackSession.update({
      where: { id: sessionRow.id },
      data: {
        // Інкремент, а не перерахунок: сотні точок за день не варто
        // агрегувати на кожному флаші. Поправка — різниця «дорога мінус
        // пряма» по розривах; на щільному треку вона нульова.
        distanceKm: { increment: prepared.addedKm + gapCorrectionM / 1000 },
        pointsCount: { increment: prepared.points.length },
        lastPointAt: prepared.lastAt ?? undefined,
      },
      select: { distanceKm: true, pointsCount: true },
    }),
  ]);

  return NextResponse.json({
    accepted: prepared.points.length,
    rejected: prepared.rejected,
    sessionDistanceKm: Math.round(updated.distanceKm * 10) / 10,
    pointsCount: updated.pointsCount,
  });
}
