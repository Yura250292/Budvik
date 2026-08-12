/**
 * Усе, що планшет показує за день, однією відповіддю.
 *
 * Один запит замість трьох навмисно: планшет живе на мобільному інтернеті
 * в дорозі, і три окремі round-trip'и означали б три шанси показати
 * спінер посеред маршруту.
 *
 * Ролі бачать різне: водій — точки маршрутного листа, торговий — своїх
 * клієнтів (їх віддає /api/sales/my-map, тут не дублюємо). Спільне для
 * обох — уже проставлені візити і власний трек, бо саме вони мусять
 * пережити перезавантаження сторінки.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { resolveDriverDay } from "@/lib/track/day-stops";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["DRIVER", "SALES", "ADMIN", "MANAGER"];

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

  // Водій завжди дивиться свій день; адмін може підглянути чужий, щоб
  // розібрати ситуацію постфактум.
  const userId =
    session.user.role === "DRIVER" || session.user.role === "SALES"
      ? session.user.id
      : url.searchParams.get("userId") || session.user.id;

  const [route, visits, trackSession, points] = await Promise.all([
    resolveDriverDay(userId, day),
    prisma.visit.findMany({
      where: { userId, day: dayStart },
      select: {
        id: true,
        counterpartyId: true,
        status: true,
        comment: true,
        money: true,
        collectedAmount: true,
        markedAt: true,
      },
    }),
    prisma.trackSession.findUnique({
      where: { userId_day: { userId, day: dayStart } },
      select: { distanceKm: true, pointsCount: true, lastPointAt: true, startedAt: true },
    }),
    // Трек віддаємо прорідженим: малювати polyline із 300 точок на
    // планшеті немає сенсу, а перші 30 секунд завантаження карти важать
    // більше за метрову точність лінії.
    prisma.trackPoint.findMany({
      where: { userId, session: { day: dayStart } },
      orderBy: { recordedAt: "asc" },
      select: { lat: true, lng: true, recordedAt: true },
    }),
  ]);

  const visitByClient = Object.fromEntries(
    visits.filter((v) => v.counterpartyId).map((v) => [v.counterpartyId, v])
  );

  const stops = route.stops.map((s) => ({
    ...s,
    visit: s.counterpartyId ? (visitByClient[s.counterpartyId] ?? null) : null,
  }));

  const done = stops.filter((s) => s.visit?.status === "DONE").length;
  const missed = stops.filter((s) => s.visit?.status === "MISSED").length;

  return NextResponse.json({
    day,
    role: session.user.role,
    route: { ...route, stops },
    progress: {
      total: stops.length,
      done,
      missed,
      left: stops.length - done - missed,
      /** Скільки грошей уже зібрано за відмітками, ₴ */
      collected: visits.reduce((sum, v) => sum + (v.collectedAmount ?? 0), 0),
      /** Скільки боргу планувалося забрати, ₴ */
      debtPlanned: stops.reduce((sum, s) => sum + s.debtAmount, 0),
    },
    track: {
      distanceKm: trackSession ? Math.round(trackSession.distanceKm * 10) / 10 : 0,
      pointsCount: trackSession?.pointsCount ?? 0,
      lastPointAt: trackSession?.lastPointAt ?? null,
      startedAt: trackSession?.startedAt ?? null,
      path: points.map((p) => [p.lat, p.lng] as [number, number]),
    },
    /** Візити поза планом — щоб UI показав їх окремим списком */
    extraVisits: visits.filter(
      (v) => !route.stops.some((s) => s.counterpartyId === v.counterpartyId)
    ),
  });
}
