/**
 * Повний трек людини за день + її відмітки візитів.
 *
 * Розбір польотів постфактум: керівник відкриває день і бачить, де водій
 * був насправді (трек), куди мав заїхати (точки маршруту) і що там
 * сталося за його словами (візити). Розбіжність між цими трьома шарами і
 * є предметом розмови.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { attachVisits, resolveDriverDay } from "@/lib/track/day-stops";
import { buildTrackPath } from "@/lib/track/gaps";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "MANAGER"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { userId } = await params;
  const url = new URL(req.url);
  const day = url.searchParams.get("day") || kyivDate(new Date());
  const dayStart = kyivDayStart(day);

  const [user, trackSession, points, visits, route] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true, color: true },
    }),
    prisma.trackSession.findUnique({
      where: { userId_day: { userId, day: dayStart } },
      select: { distanceKm: true, pointsCount: true, startedAt: true, lastPointAt: true },
    }),
    prisma.trackPoint.findMany({
      where: { userId, session: { day: dayStart } },
      orderBy: { recordedAt: "asc" },
      select: {
        lat: true,
        lng: true,
        recordedAt: true,
        speedKmh: true,
        accuracyM: true,
        gapGeometry: true,
      },
    }),
    prisma.visit.findMany({
      where: { userId, day: dayStart },
      orderBy: { markedAt: "asc" },
      include: { counterparty: { select: { name: true, deliveryLat: true, deliveryLng: true } } },
    }),
    resolveDriverDay(userId, day),
  ]);

  if (!user) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  // Пробіг з 1С за той самий день — головна звірка вкладки: маршрутний
  // лист каже одне, GPS інше. Трек по прямій завжди коротший за дорогу,
  // тому висновок робить людина, а не поріг у коді.
  const sheet = await prisma.routeSheet.findFirst({
    where: { driverId: userId, date: { gte: dayStart, lte: new Date(dayStart.getTime() + 86_399_999) } },
    select: { number: true, distanceKm: true, ordersTotal: true, debtsTotal: true },
  });

  return NextResponse.json({
    day,
    user,
    track: {
      distanceKm: trackSession ? Math.round(trackSession.distanceKm * 10) / 10 : 0,
      pointsCount: trackSession?.pointsCount ?? 0,
      startedAt: trackSession?.startedAt ?? null,
      lastPointAt: trackSession?.lastPointAt ?? null,
      points,
      /**
       * Готова лінія для карти: там, де планшет був офлайн, замість прямої
       * через півміста вплетено реальну дорогу. Окремим полем, а не
       * замість points: точки несуть швидкість і точність, які потрібні
       * для розбору «стояв чи їхав».
       */
      path: buildTrackPath(points),
    },
    // Точки з приклеєними відмітками — карта фарбує їх за статусом візиту
    // так само, як планшет у водія.
    route: { ...route, stops: attachVisits(route.stops, visits) },
    visits,
    sheet1C: sheet
      ? {
          number: sheet.number,
          distanceKm: sheet.distanceKm,
          ordersTotal: sheet.ordersTotal,
          debtsTotal: sheet.debtsTotal,
          collected: visits.reduce((s, v) => s + (v.collectedAmount ?? 0), 0),
        }
      : null,
  });
}
