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
import { orderCountsByDay } from "@/lib/track/orders-today";
import { resolveRouteForDay } from "@/lib/routes/resolve";
import { computeOverrun } from "@/lib/shift/plan-overrun";
import { readCachedLegs } from "@/lib/shift/base-legs";

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
  const onlyUnconfirmed = url.searchParams.get("confirmed") === "0";

  const where: Record<string, unknown> = {};
  if (from && to) {
    where.startedAt = { gte: kyivDayStart(from), lte: kyivDayEnd(to) };
  }
  if (userId) where.userId = userId;
  if (onlySuspicious) where.odometerSuspicious = true;
  /**
   * «Не підтверджені» — це зміни, закриті без фінішного фото, яким ще
   * ніхто не сказав «так було». Звичайні закриті сюди не потрапляють:
   * у них є фото одометра, і підтверджувати там нема чого.
   */
  if (onlyUnconfirmed) {
    where.closedLate = true;
    where.confirmedAt = null;
  }

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
      // Розклад пробігу: скільки з нього намалювало тремтіння на стоянці.
      // Без цього числа «чому вчора було 82, а сьогодні 64» не пояснити.
      stopKm: true,
      walkKm: true,
      filledKm: true,
      odometerToGpsRatio: true,
      personalKm: true,
      odometerSuspicious: true,
      closedAutomatically: true,
      closedLate: true,
      lateCloseSource: true,
      afterWorkKm: true,
      confirmedAt: true,
      confirmSource: true,
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

  /**
   * Подача береться ЛИШЕ з кешу — без походів до OSRM.
   *
   * Список — це двісті рядків, і рахувати плечі для кожного нового
   * маршруту наживо означало б чекати хвилини й покласти публічний
   * демо-сервер. Кеш наповнює картка зміни (її відкривають по одній) і
   * збереження бази в довіднику. Поки плечей немає, у списку показується
   * план без подачі — з тим самим підписом, що й у картці.
   */
  const vehicles = await prisma.salesVehicle.findMany({
    where: { repId: { in: [...new Set(shifts.map((s) => s.userId))] } },
    select: { repId: true, baseLegsKm: true },
  });
  const legsByRep = new Map(vehicles.map((v) => [v.repId, v.baseLegsKm]));

  const plans = new Map<string, number | null>();
  await Promise.all(
    [...planKeys].map(async ([key, { repId, day }]) => {
      const route = await resolveRouteForDay(repId, day);
      if (route?.totalDistanceKm == null) {
        plans.set(key, null);
        return;
      }
      const legs = readCachedLegs(legsByRep.get(repId) ?? null, route.templateId);
      plans.set(key, route.totalDistanceKm + (legs?.totalKm ?? 0));
    })
  );

  /**
   * Замовлення того дня — щоб у списку поруч із кілометрами стояв
   * результат. Сто вісімдесят кілометрів і жодного замовлення — теж
   * відповідь, просто інша, і побачити її треба до того, як відкриєш
   * картку.
   */
  const orderCounts =
    from && to
      ? await orderCountsByDay(from, to)
      : new Map<string, number>();

  const rows = shifts.map((s) => {
    const day = kyivDate(s.startedAt);
    const plannedKm = plans.get(`${s.userId}|${day}`) ?? null;
    return {
      ...s,
      name: s.user.name,
      pointsCount: s._count.points,
      ordersCount: orderCounts.get(`${s.userId}|${day}`) ?? 0,
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
      unconfirmed: shifts.filter((s) => s.closedLate && !s.confirmedAt).length,
      overrunning: rows.filter((r) => r.overrun?.exceeded).length,
    },
  });
}
