/**
 * Одна зміна повністю: обидва фото одометра, трек на карті, звірка.
 *
 * Трек віддається двома шарами. Робочий (SHIFT) — те, за що платять.
 * Пост-змінний (AFTER_SHIFT) — поїздки після закриття зміни, які
 * пристрій зафіксував, бо машина від'їхала більш ніж на кілометр.
 * Змішувати їх в одну лінію не можна: висновок з них різний.
 *
 * Третій шар — ПЛАН: маршрут, призначений торговому на цей день. Він не
 * факт і не доказ, а лінійка, до якої прикладають перші два.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildTrackPath } from "@/lib/track/gaps";
import { kyivDate, kyivTime } from "@/lib/date/kyiv";
import { ordersTodayForRep } from "@/lib/track/orders-today";
import { resolveRouteForDay } from "@/lib/routes/resolve";
import { comparePlanWithTrack } from "@/lib/track/plan-vs-fact";
import {
  computeOverrun,
  computeStopCoverage,
  OVERRUN_THRESHOLD_PCT,
} from "@/lib/shift/plan-overrun";
import { resolveLegs } from "@/lib/shift/base-legs";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "MANAGER"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { id } = await params;

  const shift = await prisma.shift.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, role: true } },
      reads: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          phase: true,
          photoUrl: true,
          aiValue: true,
          aiConfidence: true,
          aiDigitsRead: true,
          aiIsTripMeter: true,
          rejectedReason: true,
          createdAt: true,
        },
      },
    },
  });

  if (!shift) return NextResponse.json({ error: "Зміну не знайдено" }, { status: 404 });

  const points = await prisma.trackPoint.findMany({
    where: { shiftId: id },
    orderBy: { recordedAt: "asc" },
    select: {
      lat: true,
      lng: true,
      recordedAt: true,
      speedKmh: true,
      accuracyM: true,
      gapGeometry: true,
      phase: true,
    },
  });

  const shiftPoints = points.filter((p) => p.phase !== "AFTER_SHIFT");
  const afterPoints = points.filter((p) => p.phase === "AFTER_SHIFT");

  /**
   * Скільки разів торговий перезнімав панель.
   *
   * Одне-два — нормально (відблиск, темно). Систематичні п'ять спроб —
   * привід глянути, чи не підбиралося «зручне» число.
   */
  const attempts = {
    start: shift.reads.filter((r) => r.phase === "START").length,
    end: shift.reads.filter((r) => r.phase === "END").length,
  };

  /**
   * План беремо за днем ПОЧАТКУ зміни, а не за днем її закриття.
   *
   * Зміна перетинає північ регулярно: виїзд о 18:16, повернення після
   * опівночі. Маршрут при цьому призначений на той день, коли торговий
   * виїжджав, і брати план за датою закриття означало б порівнювати
   * вечірню поїздку з планом наступного ранку.
   */
  const planDay = kyivDate(shift.startedAt);
  const planned = await resolveRouteForDay(shift.userId, planDay);

  // Порівнюємо з РОБОЧИМИ точками: поїздки після закриття зміни планом
  // не передбачені за визначенням, і рахувати їх відхиленням від нього
  // означало б звинувачувати людину за дорогу додому.
  const planVsFact = comparePlanWithTrack(shiftPoints, planned);

  /**
   * Подача — дорога з дому/складу до маршруту й назад. Без неї план
   * занижений рівно на ті кілометри, які торговий чесно намотав, доїжджаючи
   * до першого пункту, і кожен, хто живе не в ньому, виглядав би винним.
   */
  const vehicle = await prisma.salesVehicle.findUnique({
    where: { repId: shift.userId },
    select: { baseAddress: true, baseLat: true, baseLng: true, baseLegsKm: true },
  });

  const base =
    vehicle?.baseLat != null && vehicle.baseLng != null
      ? { lat: vehicle.baseLat, lng: vehicle.baseLng }
      : null;

  const legs = planned
    ? await resolveLegs(
        shift.userId,
        planned.templateId,
        base,
        planned.stops,
        vehicle?.baseLegsKm ?? null
      )
    : null;

  /**
   * Повний план = маршрут + подача. Якщо бази немає, план лишається голим
   * маршрутом, і UI про це прямо попереджає: краще визнати неповноту
   * цифри, ніж мовчки видати занижений план за істину.
   */
  const plannedTotalKm =
    planned?.totalDistanceKm != null
      ? Math.round((planned.totalDistanceKm + (legs?.totalKm ?? 0)) * 10) / 10
      : null;

  /**
   * Перевитрата рахується від одометра, а якщо його немає (зміна ще
   * триває, фінішного фото немає) — від GPS. Друге гірше: трек із дірками
   * занижений, — але «нічого не показати» гірше за приблизну цифру з
   * підписом, звідки вона.
   */
  const actualKm = shift.distanceKm ?? shift.gpsDistanceKm;
  const overrun = computeOverrun(actualKm, plannedTotalKm);

  /**
   * Скільки пунктів плану трек реально зачепив. Рахуємо по РОБОЧИХ точках:
   * заїзд у село після закриття зміни — не виконання маршруту.
   */
  const coverage = planned ? computeStopCoverage(planned.stops, shiftPoints) : null;

  /**
   * Кого торговий сьогодні опрацював.
   *
   * Питання «куди їздив» без цього має половину відповіді: лінія на
   * карті показує дорогу, але не те, заради чого вона була. Замовлення
   * дня лягають на ту саму карту, і зміна нарешті читається цілком —
   * скільки кілометрів, до кого заїхав, що з того вийшло.
   */
  const orders = await ordersTodayForRep(shift.userId, planDay);

  return NextResponse.json({
    orders,
    shift: {
      ...shift,
      user: undefined,
      reads: undefined,
    },
    user: shift.user,
    reads: shift.reads,
    attempts,
    track: {
      shift: {
        points: shiftPoints,
        path: buildTrackPath(shiftPoints),
        pointsCount: shiftPoints.length,
      },
      afterShift: {
        points: afterPoints,
        path: buildTrackPath(afterPoints),
        pointsCount: afterPoints.length,
      },
    },
    plan: {
      day: planDay,
      route: planVsFact.plan
        ? {
            templateId: planVsFact.plan.templateId,
            name: planVsFact.plan.name,
            totalDistanceKm: planVsFact.plan.totalDistanceKm,
            geometry: planVsFact.plan.geometry,
            stops: planVsFact.plan.stops,
            source: planVsFact.plan.source,
          }
        : null,
      overrun,
      thresholdPct: OVERRUN_THRESHOLD_PCT,
      /**
       * База й подача віддаються окремо від overrun, щоб панель могла
       * показати САМУ АРИФМЕТИКУ: 246 км маршруту + 18 км подачі. Інакше
       * підсумкові 264 виглядали б числом, яке взялося нізвідки.
       */
      base: base
        ? { lat: base.lat, lng: base.lng, address: vehicle?.baseAddress ?? null }
        : null,
      legs,
      routeKm: planned?.totalDistanceKm ?? null,
      coverage,
      /**
       * Епізоди виходу вбік ідуть поруч із перевитратою, бо відповідають
       * на різні питання: перевитрата каже СКІЛЬКИ зайвого, епізоди — ДЕ.
       * Час форматуємо на сервері: київська таймзона живе тут.
       */
      deviation: planVsFact.deviation
        ? {
            onRouteRatio: planVsFact.deviation.onRouteRatio,
            offRouteKm: planVsFact.deviation.offRouteKm,
            excursions: planVsFact.deviation.excursions.map((e) => ({
              minutes: e.minutes,
              km: e.km,
              maxDistanceM: e.maxDistanceM,
              lat: e.lat,
              lng: e.lng,
              fromTime: kyivTime(e.from),
              toTime: kyivTime(e.to),
            })),
          }
        : null,
      corridorM: planVsFact.corridorM,
      planFromGeometry: planVsFact.planFromGeometry,
    },
  });
}
