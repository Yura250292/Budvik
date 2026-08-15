/**
 * Список змін торгових за період.
 *
 * Головне питання, на яке відповідає екран: чи збігається пробіг за
 * одометром із тим, що бачив GPS. Тому в рядку поруч стоять обидва
 * числа й співвідношення між ними.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDayStart, kyivDayEnd } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const userId = url.searchParams.get("userId");
  const onlySuspicious = url.searchParams.get("suspicious") === "1";

  const where: Record<string, unknown> = {};
  if (from && to) {
    where.startedAt = { gte: kyivDayStart(from), lte: kyivDayEnd(to) };
  }
  if (userId) where.userId = userId;
  if (onlySuspicious) where.odometerSuspicious = true;

  const shifts = await prisma.shift.findMany({
    where,
    orderBy: { startedAt: "desc" },
    take: 200,
    select: {
      id: true,
      userId: true,
      status: true,
      startedAt: true,
      endedAt: true,
      startOdometer: true,
      endOdometer: true,
      startOdometerSource: true,
      endOdometerSource: true,
      distanceKm: true,
      durationMinutes: true,
      gpsDistanceKm: true,
      odometerToGpsRatio: true,
      personalKm: true,
      odometerSuspicious: true,
      closedAutomatically: true,
      startPhotoUrl: true,
      endPhotoUrl: true,
      user: { select: { name: true, role: true } },
      _count: { select: { points: true } },
    },
  });

  return NextResponse.json({
    shifts: shifts.map((s) => ({
      ...s,
      name: s.user.name,
      pointsCount: s._count.points,
      user: undefined,
      _count: undefined,
    })),
    summary: {
      count: shifts.length,
      totalKm: shifts.reduce((sum, s) => sum + (s.distanceKm ?? 0), 0),
      suspicious: shifts.filter((s) => s.odometerSuspicious).length,
      autoClosed: shifts.filter((s) => s.closedAutomatically).length,
    },
  });
}
