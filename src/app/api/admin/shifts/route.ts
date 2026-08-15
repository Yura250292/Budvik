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
import { kyivDate, kyivDayStart, kyivDayEnd } from "@/lib/date/kyiv";
import { resolveRouteForDay } from "@/lib/routes/resolve";
import { computeOverrun } from "@/lib/shift/plan-overrun";

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

  /**
   * Планові кілометри на кожну зміну.
   *
   * Резолвимо по УНІКАЛЬНІЙ парі (торговий, день), а не на кожен рядок:
   * у списку буває дві сотні змін, і серед них десятки припадають на той
   * самий день того самого напрямку. Без дедуплікації екран робив би
   * двісті однакових запитів до бази заради двадцяти відповідей.
   *
   * День беремо за початком зміни — та сама причина, що й у картці:
   * зміна може перетнути північ, а маршрут призначений на день виїзду.
   */
  const planKeys = new Map<string, { repId: string; day: string }>();
  for (const s of shifts) {
    const day = kyivDate(s.startedAt);
    planKeys.set(`${s.userId}|${day}`, { repId: s.userId, day });
  }

  const plans = new Map<string, number | null>();
  await Promise.all(
    [...planKeys].map(async ([key, { repId, day }]) => {
      const route = await resolveRouteForDay(repId, day);
      plans.set(key, route?.totalDistanceKm ?? null);
    })
  );

  const rows = shifts.map((s) => {
    const plannedKm = plans.get(`${s.userId}|${kyivDate(s.startedAt)}`) ?? null;
    return {
      ...s,
      name: s.user.name,
      pointsCount: s._count.points,
      // Одометр — база порівняння; GPS лише коли зміна ще не закрита.
      overrun: computeOverrun(s.distanceKm ?? s.gpsDistanceKm, plannedKm),
      user: undefined,
      _count: undefined,
    };
  });

  return NextResponse.json({
    shifts: rows,
    summary: {
      count: shifts.length,
      totalKm: shifts.reduce((sum, s) => sum + (s.distanceKm ?? 0), 0),
      suspicious: shifts.filter((s) => s.odometerSuspicious).length,
      autoClosed: shifts.filter((s) => s.closedAutomatically).length,
      overrunning: rows.filter((r) => r.overrun?.exceeded).length,
    },
  });
}
