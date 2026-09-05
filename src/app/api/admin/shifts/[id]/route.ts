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
import { classifyMovement, movementTotals } from "@/lib/track/movement";
import { repeatSummary, splitByMovement } from "@/lib/track/movement-parts";
import { findStops } from "@/lib/track/stops";
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
import { confirmShift, loadForConfirm } from "@/lib/shift/confirm";
import { autoCloseNote, closeWithoutPhoto } from "@/lib/shift/reconcile";

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
  /**
   * «По дорогах» — на прохання, а не завжди: розрахунок коштує десятка
   * запитів до OSRM, а картку зміни відкривають десятки разів на день.
   */
  const onRoads = req.nextUrl.searchParams.get("roads") === "1";

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
      // Є дорога для розриву — значить шлях відомий; немає — лінія між
      // точками лише здогад, і карта мусить це показати.
      roadMetersFromPrev: true,
      phase: true,
    },
  });

  const shiftPoints = points.filter((p) => p.phase !== "AFTER_SHIFT");
  const afterPoints = points.filter((p) => p.phase === "AFTER_SHIFT");

  /**
   * Ділимо трек один раз: те саме потрібне і карті (кольори), і картці
   * (скільки з дня — повернення по власному сліду).
   */
  const shiftParts = await splitByMovement(shiftPoints, onRoads);

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
        /**
         * Той самий трек, поділений за способом пересування. `path` вище
         * лишається цілим навмисно — по ньому карта рахує межі й будує
         * підказки, і рвати його заради стилю було б обміном шила на мило.
         */
        parts: shiftParts,
        /**
         * Скільки денного пробігу — повернення по власному сліду.
         *
         * Єдині кілометри дня, з якими взагалі можна щось зробити: їх
         * прибирає перекладання порядку точок у маршруті. Решта — це відстань
         * між клієнтами, і вона від нас не залежить.
         */
        repeat: repeatSummary(shiftParts),
        movement: movementTotals(classifyMovement(shiftPoints)),
        /**
         * Де людина СТОЯЛА — і це головна відповідь на питання «де були
         * торгові». Лінія відповідає на нього погано за побудовою: між двома
         * фіксами вона мусить щось намалювати, і це завжди здогад. Зупинка
         * здогадів не потребує.
         */
        stops: findStops(shiftPoints, orders.dots).map((stop) => ({
          ...stop,
          // Час форматує сервер — так само, як для епізодів відхилення:
          // київська доба одна, а браузер бухгалтера буває в іншій зоні.
          fromTime: kyivTime(stop.from),
          toTime: kyivTime(stop.to),
        })),
        pointsCount: shiftPoints.length,
        /**
         * Коли записано останню точку — і чи вона ще «жива».
         *
         * У відкритій зміні остання точка означає не кінець маршруту, а «де
         * людина зараз або де її бачили востаннє». Без цих двох полів карта
         * підписувала її «Кінець зміни» посеред робочого дня.
         */
        lastAt: shiftPoints.length > 0 ? shiftPoints[shiftPoints.length - 1].recordedAt : null,
        lastTime:
          shiftPoints.length > 0
            ? kyivTime(shiftPoints[shiftPoints.length - 1].recordedAt)
            : null,
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

/**
 * Офіс править і підтверджує зміну.
 *
 * Досі адмінка вміла лише дивитися: незакрита зміна або зміна з
 * очевидно хибним одометром лишалася такою назавжди, бо єдиний, хто міг
 * її змінити, — сам торговий у застосунку. Для WarehouseShift така
 * правка існує з самого початку (EditWarehouseShiftModal), і причина
 * там та сама: людина забуває, а число потрібне зарплаті.
 *
 * Тіло: `{ endedAt?, endOdometer?, confirm?, notes? }`. Порядок дій —
 * спершу закрити, якщо зміна ще відкрита, потім проставити одометр і
 * підтвердити; кожен крок необов'язковий.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { id } = await params;

  let body: { endedAt?: string; endOdometer?: number; confirm?: boolean; notes?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  let shift = await loadForConfirm(id);
  if (!shift) return NextResponse.json({ error: "Зміну не знайдено" }, { status: 404 });

  let endedAt: Date | undefined;
  if (body.endedAt) {
    endedAt = new Date(body.endedAt);
    if (Number.isNaN(endedAt.getTime())) {
      return NextResponse.json({ error: "Некоректний час закінчення" }, { status: 400 });
    }
  }

  /**
   * Відкриту зміну офіс закриває тим самим шляхом, що й автомат, —
   * інакше в базі з'явився б четвертий різновид закриття зі своїм
   * набором прапорців.
   */
  if (shift.status === "OPEN") {
    if (!endedAt) {
      return NextResponse.json(
        { error: "Зміна ще відкрита — вкажіть час закінчення" },
        { status: 400 }
      );
    }
    if (endedAt <= shift.startedAt) {
      return NextResponse.json(
        { error: "Час закінчення раніший за початок зміни" },
        { status: 400 }
      );
    }
    await prisma.$transaction((tx) =>
      closeWithoutPhoto(tx, shift!, {
        endedAt: endedAt!,
        source: "OFFICE",
        notes: body.notes ?? autoCloseNote("OFFICE", null),
      })
    );
    shift = await loadForConfirm(id);
    if (!shift) return NextResponse.json({ error: "Зміну не знайдено" }, { status: 404 });
    // Час уже застосований — далі його не переприсвоюємо.
    endedAt = undefined;
  }

  if (body.endOdometer != null || endedAt || body.confirm) {
    const result = await confirmShift(
      shift,
      { endOdometer: body.endOdometer, endedAt },
      { userId: session.user.id, source: "OFFICE" }
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    shift = result.shift;
  }

  if (body.notes != null) {
    await prisma.shift.update({ where: { id }, data: { notes: body.notes } });
  }

  return NextResponse.json({ shift });
}

