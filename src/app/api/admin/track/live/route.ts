/**
 * Хто зараз на маршруті — для карти керівника.
 *
 * Запит навмисно легкий: усе, що потрібно, лежить у TrackSession
 * (lastPointAt, лічильники), і таблиця точок сканується лише через
 * DISTINCT ON заради останньої координати, а не N+1 підзапитами.
 * Сторінка опитує цей ендпоінт раз на 20–30 секунд.
 *
 * Головне, що тут не так само, як здається: список будується НЕ від
 * треку. Раніше він починався з TrackSession, тобто людина без жодної
 * точки просто зникала з екрана — а це і є найважливіший випадок.
 * 26.08 у торгового з відкритою зміною за 205 хвилин була одна точка, і
 * на «На маршруті» його не було видно взагалі. Тому список — це об'єднання
 * трьох джерел: відкрита зміна, трек дня і пульс планшета. Мовчання
 * мусить бути видимим.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
// Висновок «чому не пишеться» спільний із сповіщеннями в Telegram:
// дві різні відповіді на одне питання гірші за жодної.
import { orderCountsByRep } from "@/lib/track/orders-today";
import { diagnose, HEARTBEAT_WINDOW_MIN } from "@/lib/track/diagnosis";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "MANAGER"];

/** Скільки хвилин без точки, щоб вважати трек обірваним. */
const ONLINE_WINDOW_MIN = 10;

type PointRow = {
  userId: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  recordedAt: Date;
  distanceKm: number;
  pointsCount: number;
};

type BeatRow = {
  userId: string;
  at: Date;
  tracking: boolean;
  mode: string | null;
  buffered: number;
  lastFixAt: Date | null;
  lastFixAccuracyM: number | null;
  lastError: string | null;
  locationPermission: string | null;
  locationMode: string | null;
  batteryOptimized: boolean | null;
  batteryPct: number | null;
  deviceName: string | null;
  appVersion: string | null;
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const url = new URL(req.url);
  const day = url.searchParams.get("day") || kyivDate(new Date());
  const dayStart = kyivDayStart(day);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const [points, sessions, beats, shifts] = await Promise.all([
    // Остання координата кожного — одним запитом на всіх.
    prisma.$queryRaw<PointRow[]>`
      SELECT DISTINCT ON (s."userId")
             s."userId",
             p.lat,
             p.lng,
             p."speedKmh",
             p."recordedAt",
             s."distanceKm"::float AS "distanceKm",
             s."pointsCount"
      FROM "TrackSession" s
      JOIN "TrackPoint" p ON p."sessionId" = s.id
      WHERE s.day = ${dayStart}
      ORDER BY s."userId", p."recordedAt" DESC
    `,
    prisma.trackSession.findMany({
      where: { day: dayStart },
      select: { userId: true, distanceKm: true, pointsCount: true },
    }),
    // Останній пульс кожного за цю добу.
    prisma.$queryRaw<BeatRow[]>`
      SELECT DISTINCT ON (h."userId")
             h."userId", h.at, h.tracking, h.mode, h.buffered,
             h."lastFixAt", h."lastFixAccuracyM", h."lastError",
             h."locationPermission", h."locationMode",
             h."batteryOptimized", h."batteryPct",
             h."deviceName", h."appVersion"
      FROM "DeviceHeartbeat" h
      WHERE h.at >= ${dayStart} AND h.at < ${dayEnd}
      ORDER BY h."userId", h.at DESC
    `,
    // Зміни цієї доби: саме вони кажуть, кого ми ВЗАГАЛІ маємо бачити.
    prisma.shift.findMany({
      where: { startedAt: { gte: dayStart, lt: dayEnd } },
      orderBy: { startedAt: "asc" },
      select: { userId: true, status: true, startedAt: true, endedAt: true },
    }),
  ]);

  const userIds = Array.from(
    new Set([
      ...points.map((p) => p.userId),
      ...sessions.map((s) => s.userId),
      ...beats.map((b) => b.userId),
      ...shifts.map((s) => s.userId),
    ])
  );

  if (userIds.length === 0) return NextResponse.json({ day, people: [] });

  const [users, devices, orderCounts, installed] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, role: true, color: true },
    }),
    // Чи є взагалі планшет: «немає точок» у людини без застосунку — це
    // зовсім інша розмова, ніж у людини з установленим.
    prisma.deviceToken.findMany({
      where: { userId: { in: userIds }, scope: "track", revokedAt: null },
      select: { userId: true, lastUsedAt: true },
    }),
    // Скільки клієнтів у кожного сьогодні замовили — колонка в таблиці.
    orderCountsByRep(day),
    /**
     * Яка збірка стоїть на планшеті. Пише її сам кабінет при відкритті
     * (див. /api/app/version) — це єдиний спосіб дізнатися версію в
     * тих, хто ще на збірці до 1.3 і пульсу не шле.
     */
    prisma.syncState.findMany({
      where: { key: { in: userIds.map((id) => `app:installed:${id}`) } },
      select: { key: true, value: true },
    }),
  ]);

  const versionBy = new Map(
    installed.map((row) => [row.key.replace("app:installed:", ""), row.value])
  );

  const pointBy = new Map(points.map((p) => [p.userId, p]));
  const sessionBy = new Map(sessions.map((s) => [s.userId, s]));
  const beatBy = new Map(beats.map((b) => [b.userId, b]));
  const shiftBy = new Map<string, (typeof shifts)[number]>();
  for (const s of shifts) {
    // Показуємо відкриту, якщо така є, інакше останню за день.
    const cur = shiftBy.get(s.userId);
    if (!cur || s.status === "OPEN" || s.startedAt > cur.startedAt) shiftBy.set(s.userId, s);
  }
  const deviceBy = new Map<string, Date | null>();
  for (const d of devices) {
    const cur = deviceBy.get(d.userId) ?? null;
    if (!cur || (d.lastUsedAt && d.lastUsedAt > cur)) deviceBy.set(d.userId, d.lastUsedAt);
  }

  const now = Date.now();
  const minutesSince = (d: Date | null | undefined) =>
    d ? Math.floor((now - d.getTime()) / 60_000) : null;

  const people = users.map((u) => {
    const point = pointBy.get(u.id);
    const sess = sessionBy.get(u.id);
    const beat = beatBy.get(u.id);
    const shift = shiftBy.get(u.id);

    const minutesAgo = minutesSince(point?.recordedAt);
    const beatAgo = minutesSince(beat?.at);
    const fixAgo = minutesSince(beat?.lastFixAt);
    const shiftOpen = shift?.status === "OPEN";
    const hasDevice = deviceBy.has(u.id);

    const installedVersion = versionBy.get(u.id) ?? null;

    const problem = diagnose({
      hasDevice,
      shiftOpen,
      installedVersion,
      // Точки — головний доказ того, що трек живий; пульс лише пояснює
      // їхню відсутність. Обидва числа вже пораховані вище.
      lastPointMinutesAgo: minutesAgo,
      lastPointSpeedKmh: point?.speedKmh ?? null,
      beat: beat
        ? {
            minutesAgo: beatAgo,
            tracking: beat.tracking,
            buffered: beat.buffered,
            lastFixMinutesAgo: fixAgo,
            lastFixAccuracyM: beat.lastFixAccuracyM,
            locationPermission: beat.locationPermission,
            locationMode: beat.locationMode,
            batteryOptimized: beat.batteryOptimized,
            lastError: beat.lastError,
          }
        : null,
    });

    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      color: u.color,
      /** Координати можуть бути відсутні — людина в списку, її просто немає на карті. */
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      speedKmh: point?.speedKmh ?? null,
      lastPointAt: point?.recordedAt ?? null,
      minutesAgo,
      online: minutesAgo != null && minutesAgo <= ONLINE_WINDOW_MIN,
      distanceKm: Math.round((sess?.distanceKm ?? 0) * 10) / 10,
      pointsCount: sess?.pointsCount ?? 0,
      /**
       * Скільки замовлень сьогодні від клієнтів цієї людини.
       *
       * Поруч із пробігом це найкоротша відповідь на «як пройшов день»:
       * сто кілометрів і жодного замовлення — теж результат, просто
       * інший, і побачити його треба одразу, а не в іншому розділі.
       */
      ordersToday: orderCounts.get(u.id) ?? 0,
      /** Збірка на планшеті — навіть коли пульсу немає. */
      installedVersion,
      shift: shift
        ? {
            status: shift.status,
            startedAt: shift.startedAt,
            endedAt: shift.endedAt,
            /** Скільки хвилин зміна триває без жодної точки — головна цифра. */
            silentSinceStartMin:
              shift.status === "OPEN" && !point
                ? Math.floor((now - shift.startedAt.getTime()) / 60_000)
                : null,
          }
        : null,
      /** Що планшет каже про себе сам. null — пульсу ще не було. */
      device: beat
        ? {
            at: beat.at,
            minutesAgo: beatAgo,
            alive: beatAgo != null && beatAgo <= HEARTBEAT_WINDOW_MIN,
            tracking: beat.tracking,
            mode: beat.mode,
            buffered: beat.buffered,
            lastFixAt: beat.lastFixAt,
            lastFixAccuracyM: beat.lastFixAccuracyM,
            lastFixMinutesAgo: fixAgo,
            locationPermission: beat.locationPermission,
            locationMode: beat.locationMode,
            batteryOptimized: beat.batteryOptimized,
            batteryPct: beat.batteryPct,
            lastError: beat.lastError,
            deviceName: beat.deviceName,
            appVersion: beat.appVersion,
          }
        : null,
      problem,
    };
  });

  // Спершу ті, з ким щось не так: екран існує заради них.
  people.sort((a, b) => {
    if (!!a.problem !== !!b.problem) return a.problem ? -1 : 1;
    return (a.name ?? "").localeCompare(b.name ?? "", "uk");
  });

  return NextResponse.json({ day, people });
}
