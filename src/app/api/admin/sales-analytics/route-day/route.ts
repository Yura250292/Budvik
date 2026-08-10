/**
 * Маршрут торгового на конкретний день: план проти факту.
 *
 * План — шаблон із розкладу (RouteAssignment), факт — поїздка й чекпойнти
 * з Telegram-бота. Разом на одній мапі видно, чи проїхав торговий той
 * напрямок, який мав.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayEnd, kyivDayStart, kyivTime } from "@/lib/date/kyiv";
import { resolveRouteForDay } from "@/lib/routes/resolve";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const role = session.user.role;
  const isFullAccess = FULL_ACCESS_ROLES.includes(role);
  if (!isFullAccess && role !== "SALES") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const requestedRep = searchParams.get("repId");
  const repId = isFullAccess ? requestedRep : session.user.id;
  if (!repId) {
    return NextResponse.json({ error: "Потрібен repId" }, { status: 400 });
  }
  if (!isFullAccess && repId !== session.user.id) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const dayParam = searchParams.get("date");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam ?? "") ? dayParam! : kyivDate(new Date());

  const [planned, trips, rep] = await Promise.all([
    resolveRouteForDay(repId, day),
    prisma.salesTrip.findMany({
      where: {
        userId: repId,
        startedAt: { gte: kyivDayStart(day), lte: kyivDayEnd(day) },
      },
      include: { checkpoints: { orderBy: { seq: "asc" } } },
      orderBy: { startedAt: "asc" },
    }),
    prisma.user.findUnique({ where: { id: repId }, select: { id: true, name: true } }),
  ]);

  const actual = trips.map((t) => ({
    id: t.id,
    status: t.status,
    startedAt: t.startedAt.toISOString(),
    startTime: kyivTime(t.startedAt),
    endedAt: t.endedAt?.toISOString() ?? null,
    endTime: t.endedAt ? kyivTime(t.endedAt) : null,
    distanceKm: t.distanceKm,
    durationMinutes: t.durationMinutes,
    start: t.startLat != null && t.startLng != null
      ? { lat: t.startLat, lng: t.startLng, address: t.startAddress }
      : null,
    end: t.endLat != null && t.endLng != null
      ? { lat: t.endLat, lng: t.endLng, address: t.endAddress }
      : null,
    checkpoints: t.checkpoints.map((c) => ({
      id: c.id,
      lat: c.lat,
      lng: c.lng,
      address: c.address,
      seq: c.seq,
      time: kyivTime(c.createdAt),
      minutesFromPrev: c.minutesFromPrev,
    })),
  }));

  return NextResponse.json({
    day,
    rep,
    planned,
    trips: actual,
    summary: {
      tripsCount: actual.length,
      checkpointsCount: actual.reduce((s, t) => s + t.checkpoints.length, 0),
      distanceKm: actual.reduce((s, t) => s + (t.distanceKm ?? 0), 0),
      plannedStops: planned?.stops.length ?? 0,
      plannedKm: planned?.totalDistanceKm ?? null,
    },
  });
}
