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
import type { Prisma, TrackPhase } from "@prisma/client";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { preparePoints, MAX_ACCURACY_M, type RawPoint } from "@/lib/track/geo";
import { findGaps, resolveGaps } from "@/lib/track/gaps";
import { verifyDeviceToken, TRACK_ROLES } from "@/lib/track/device-token";

export const dynamic = "force-dynamic";

/** Хто возить планшет. Решті ролей трек ні до чого. */
const ALLOWED_ROLES = TRACK_ROLES;

/** Стеля на пачку: більше — це вже не буфер, а спроба залити історію. */
const MAX_BATCH = 500;

/**
 * Скільки останніх точок дня читаємо як опору для нової пачки.
 *
 * Достатньо, щоб накрити типовий відрізок між надійними фіксами (при
 * точці раз на 20 секунд це понад пів години суцільно слабкого
 * приймання), і мало, щоб не тягати день цілком на кожній пачці.
 */
const TAIL_POINTS = 120;

/**
 * Запас на межах зміни: годинник планшета зсунутий на кілька хвилин, і
 * без нього точки на початку дня падали б «перед зміною».
 */
const SHIFT_GRACE_MS = 15 * 60_000;

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

  /**
   * Пачка може перетинати київську північ.
   *
   * Планшет, що простояв ніч без зв'язку, віддає буфер уранці одним
   * шматком — і в ньому кінець учорашнього дня та початок сьогоднішнього.
   * Доба бралася з ПЕРШОЇ точки, тож увесь ранок лягав у вчорашню сесію
   * і на сьогоднішній карті не з'являвся зовсім. Тому ділимо пачку по
   * добах і кожну частину пишемо у свою сесію.
   */
  const byDay = new Map<string, RawPoint[]>();
  let malformedAtTop = 0;

  for (const point of raw) {
    const at = new Date(point?.recordedAt ?? NaN);
    if (Number.isNaN(at.getTime())) {
      // Точку без часу нікуди віднести: у відповіді вона піде як
      // malformed, рівно як її порахував би preparePoints.
      malformedAtTop++;
      continue;
    }
    const key = kyivDate(at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(point);
    else byDay.set(key, [point]);
  }

  if (byDay.size === 0) {
    return NextResponse.json(
      { error: "Жодної точки з коректним recordedAt" },
      { status: 400 }
    );
  }

  const wantsAfterShift = String(body.phase ?? "").toUpperCase() === "AFTER_SHIFT";

  const totals = {
    accepted: 0,
    untrusted: 0,
    rejected: { accuracy: 0, stale: 0, malformed: malformedAtTop },
  };
  let latest: { day: string; distanceKm: number; pointsCount: number } | null = null;

  // Доби йдуть по порядку: сесія молодшого дня має бачити опори старшого
  // вже записаними, інакше пробіг ранку рахувався б від порожнечі.
  for (const day of [...byDay.keys()].sort()) {
    const result = await ingestDay(userId, day, byDay.get(day)!, wantsAfterShift);
    totals.accepted += result.accepted;
    totals.untrusted += result.untrusted;
    totals.rejected.accuracy += result.rejected.accuracy;
    totals.rejected.stale += result.rejected.stale;
    totals.rejected.malformed += result.rejected.malformed;
    // Планшет показує пробіг поточного дня — віддаємо найсвіжіший.
    if (!latest || day > latest.day) {
      latest = { day, distanceKm: result.distanceKm, pointsCount: result.pointsCount };
    }
  }

  return NextResponse.json({
    accepted: totals.accepted,
    // Скільки з прийнятих — «на віру»: планшет показує це в сповіщенні,
    // і саме за цим числом видно, що фікс поплив, а не що трек перервався.
    untrusted: totals.untrusted,
    rejected: totals.rejected,
    sessionDistanceKm: Math.round((latest?.distanceKm ?? 0) * 10) / 10,
    pointsCount: latest?.pointsCount ?? 0,
  });
}

/**
 * Запис однієї київської доби з пачки.
 *
 * Винесено з обробника, бо пачка після нічного офлайну містить дві доби,
 * а кожна доба — це своя сесія, свої опори і свій пробіг.
 */
async function ingestDay(
  userId: string,
  day: string,
  raw: RawPoint[],
  wantsAfterShift: boolean
): Promise<{
  accepted: number;
  untrusted: number;
  rejected: { accuracy: number; stale: number; malformed: number };
  distanceKm: number;
  pointsCount: number;
}> {
  const dayStart = kyivDayStart(day);

  const sessionRow = await prisma.trackSession.upsert({
    where: { userId_day: { userId, day: dayStart } },
    create: { userId, day: dayStart },
    update: {},
    select: { id: true, distanceKm: true, pointsCount: true },
  });

  /**
   * Хвіст уже записаного дня: з нього виходять усі три опори.
   *
   * `last` — остання точка будь-якої якості: від неї рахується
   * metersFromPrev і ловляться повтори пачки. `lastTrusted` — остання
   * точка з доброю похибкою: від неї росте пробіг. А слабкі фікси, що
   * лягли ПІСЛЯ неї, — це чернетка дороги, якою поведе OSRM.
   *
   * Одним запитом, а не трьома: хвіст усе одно доводиться читати, і
   * ділити його на кілька походів у базу на кожній пачці — марно.
   */
  const tail = await prisma.trackPoint.findMany({
    where: { sessionId: sessionRow.id },
    orderBy: { recordedAt: "desc" },
    take: TAIL_POINTS,
    select: { lat: true, lng: true, recordedAt: true, accuracyM: true },
  });

  const isTrusted = (p: { accuracyM: number | null }) =>
    p.accuracyM == null || p.accuracyM <= MAX_ACCURACY_M;

  const last = tail[0] ?? null;
  const trustedIdx = tail.findIndex(isTrusted);

  /**
   * Опора могла лишитися за межами хвоста: при поганому прийманні
   * слабкими бувають сотні точок поспіль. Тоді доводиться сходити по
   * неї окремо — інакше пробіг рахувався б від тремтіння вежі.
   */
  const lastTrusted =
    trustedIdx >= 0
      ? tail[trustedIdx]
      : await prisma.trackPoint.findFirst({
          where: {
            sessionId: sessionRow.id,
            OR: [{ accuracyM: null }, { accuracyM: { lte: MAX_ACCURACY_M } }],
          },
          orderBy: { recordedAt: "desc" },
          select: { lat: true, lng: true, recordedAt: true },
        });

  // Хвіст іде з бази від новіших до старіших — розвертаємо, бо дорога
  // прокладається в порядку руху.
  const sinceTrusted = (trustedIdx >= 0 ? tail.slice(0, trustedIdx) : tail)
    .filter((p) => !isTrusted(p))
    .map((p) => ({ lat: p.lat, lng: p.lng }))
    .reverse();

  const prepared = preparePoints(raw, last, lastTrusted, sinceTrusted);

  if (prepared.points.length === 0) {
    return {
      accepted: 0,
      untrusted: 0,
      rejected: prepared.rejected,
      distanceKm: sessionRow.distanceKm,
      pointsCount: sessionRow.pointsCount,
    };
  }

  const resolveShift = await shiftResolver(userId, prepared, wantsAfterShift);

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
      data: prepared.points.map((p, i) => {
        const shift = resolveShift(p.recordedAt);
        return {
          sessionId: sessionRow.id,
          userId,
          shiftId: shift.shiftId,
          phase: shift.phase,
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
        };
      }),
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

  return {
    accepted: prepared.points.length,
    untrusted: prepared.untrusted,
    rejected: prepared.rejected,
    distanceKm: updated.distanceKm,
    pointsCount: updated.pointsCount,
  };
}

/**
 * До якої зміни належить кожна точка.
 *
 * Визначаємо на сервері, а не віримо пристрою: застосунок міг не знати,
 * що зміну закрив адмін, і клеїв би точки до закритої.
 *
 * Але головне тут інше — зміну шукаємо за ЧАСОМ ТОЧКИ, а не за тим, яка
 * зміна відкрита в момент прийому. Досі буфер, що доїхав після закриття
 * зміни (планшет був офлайн, торговий закрив день і аж тоді зловив
 * зв'язок), не отримував зміни зовсім: `shiftId` лишався порожній, і ці
 * кілометри не потрапляли в звірку з одометром — саме той хвіст дороги,
 * якого в ній і бракувало.
 *
 * AFTER_SHIFT чіпляється до ОСТАННЬОЇ закритої зміни — так «чи не
 * таксував після роботи» видно поруч із самою зміною, а не окремим
 * безхазяйним треком.
 */
async function shiftResolver(
  userId: string,
  prepared: { points: Array<{ recordedAt: Date }> },
  wantsAfterShift: boolean
): Promise<(at: Date) => { shiftId: string | null; phase: TrackPhase | null }> {
  const times = prepared.points.map((p) => p.recordedAt.getTime());
  const from = new Date(Math.min(...times) - SHIFT_GRACE_MS);
  const to = new Date(Math.max(...times) + SHIFT_GRACE_MS);

  const shifts = await prisma.shift.findMany({
    where: {
      userId,
      startedAt: { lte: to },
      OR: [{ endedAt: null }, { endedAt: { gte: from } }],
    },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true, endedAt: true, status: true },
  });

  const openShift = shifts.find((s) => s.status === "OPEN") ?? null;
  const lastClosed = shifts.find((s) => s.status !== "OPEN") ?? null;

  return (at: Date) => {
    if (wantsAfterShift) {
      // Пристрій каже, що це вже не робота. Тоді точка чіпляється до
      // зміни, яка щойно закінчилась, — і тільки як AFTER_SHIFT.
      return lastClosed
        ? { shiftId: lastClosed.id, phase: "AFTER_SHIFT" }
        : { shiftId: null, phase: null };
    }

    /**
     * Запас на межах зміни — через годинник планшета.
     *
     * Час точки ставить сам пристрій, і він буває зсунутий на кілька
     * хвилин. Без запасу перші точки дня опинялися б «перед зміною» і
     * випадали з пробігу так само, як досі випадав хвіст.
     */
    const inside = shifts.find(
      (s) =>
        at.getTime() >= s.startedAt.getTime() - SHIFT_GRACE_MS &&
        (s.endedAt == null || at.getTime() <= s.endedAt.getTime() + SHIFT_GRACE_MS)
    );
    if (inside) return { shiftId: inside.id, phase: "SHIFT" };

    // Точка поза всіма змінами: за відкритої зміни лишаємо давню
    // поведінку (це просто ранок перед відкриттям), інакше — нічия.
    // Фаза лише там, де зміна відома: старий трек водіїв про зміни
    // нічого не знає, і мітити його не можна.
    return openShift
      ? { shiftId: openShift.id, phase: "SHIFT" }
      : { shiftId: null, phase: null };
  };
}
