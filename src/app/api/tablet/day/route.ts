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
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import {
  attachVisits,
  resolveDriverDay,
  resolveDriverRoute,
  stableStopKey,
} from "@/lib/track/day-stops";
import { buildTrackPath } from "@/lib/track/gaps";
import { handoversForDay } from "@/lib/drivers/cash";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";

export const dynamic = "force-dynamic";


export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;
  const me = auth.me;

  const url = new URL(req.url);
  const requestedDay = url.searchParams.get("day") || kyivDate(new Date());
  /** Конкретний лист із кабінету водія — сильніший за дату. */
  const routeKey = url.searchParams.get("route");

  // Водій завжди дивиться свій день; адмін може підглянути чужий, щоб
  // розібрати ситуацію постфактум.
  const userId =
    me.role === "DRIVER" || me.role === "SALES"
      ? me.userId
      : url.searchParams.get("userId") || me.userId;

  /**
   * Маршрут читаємо ПЕРШИМ, а не в загальному Promise.all.
   *
   * Коли відкривають конкретний лист, доба береться з нього, а не з
   * запиту: інакше вчорашній маршрут показувався б із сьогоднішніми
   * відмітками, треком і касою — тобто з чужими числами, які виглядають
   * як свої.
   */
  const route = routeKey
    ? await resolveDriverRoute(userId, routeKey)
    : await resolveDriverDay(userId, requestedDay);

  const day = route.day ?? requestedDay;
  const dayStart = kyivDayStart(day);

  const [visits, trackSession, points, handovers, myOrder] = await Promise.all([
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
      select: { lat: true, lng: true, recordedAt: true, gapGeometry: true },
    }),
    handoversForDay(userId, dayStart),
    /**
     * Порядок, який водій склав собі на цей лист.
     *
     * Читаємо тут, а не тільки на карті: інакше два екрани того самого
     * маршруту показують різного «наступного» — карта той, що водій
     * перетягнув, а список дня той, що набив 1С. Людина довіряє тому, який
     * бачить останнім, і їде не туди.
     */
    route.id
      ? prisma.driverRouteOrder.findUnique({
          where: { driverId_routeKey: { driverId: userId, routeKey: route.id } },
          select: { stopKeys: true },
        })
      : null,
  ]);

  /**
   * Розкладаємо точки за порядком водія.
   *
   * Ключі, яких він не чіпав (маршрут поповнили після збереження), їдуть у
   * хвіст, а невідомі просто зникають — саме так, як це робить панель на
   * карті. Порядок один на всі екрани, і живе він в одному місці.
   */
  const ordered = myOrder?.stopKeys.length
    ? (() => {
        // Порядок збережено СТАЛИМИ прикметами точок, а не id рядків: ті
        // перестворюються при кожному обміні (див. stableStopKey).
        const byStable = new Map(route.stops.map((st) => [stableStopKey(st), st]));
        const picked = myOrder.stopKeys
          .map((k) => byStable.get(k))
          .filter((st): st is (typeof route.stops)[number] => !!st);
        const used = new Set(picked.map((st) => st.key));
        return [...picked, ...route.stops.filter((st) => !used.has(st.key))];
      })()
    : route.stops;

  const stops = attachVisits(ordered, visits);

  const done = stops.filter((s) => s.visit?.status === "DONE").length;
  const missed = stops.filter((s) => s.visit?.status === "MISSED").length;

  // Каса рахується з тих самих відміток, що progress.collected, але
  // мінус уже здане — водієві на екрані потрібне саме «скільки везти».
  const collected = round(visits.reduce((sum, v) => sum + (v.collectedAmount ?? 0), 0));
  const handed = round(handovers.reduce((sum, h) => sum + h.amount, 0));

  return NextResponse.json({
    day,
    role: me.role,
    route: { ...route, stops, myOrder: !!myOrder?.stopKeys.length },
    progress: {
      total: stops.length,
      done,
      missed,
      left: stops.length - done - missed,
      /** Скільки грошей уже зібрано за відмітками, ₴ */
      collected,
      /** Скільки боргу планувалося забрати, ₴ */
      debtPlanned: stops.reduce((sum, s) => sum + s.debtAmount, 0),
    },
    track: {
      distanceKm: trackSession ? Math.round(trackSession.distanceKm * 10) / 10 : 0,
      pointsCount: trackSession?.pointsCount ?? 0,
      lastPointAt: trackSession?.lastPointAt ?? null,
      startedAt: trackSession?.startedAt ?? null,
      path: buildTrackPath(points),
    },
    /** Візити поза планом — щоб UI показав їх окремим списком */
    extraVisits: visits.filter(
      (v) => !route.stops.some((s) => s.counterpartyId === v.counterpartyId)
    ),
    /** Каса за день: скільки зібрав, скільки здав, скільки везе */
    cash: { collected, handed, onHands: round(collected - handed), handovers },
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
