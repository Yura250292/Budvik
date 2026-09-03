/**
 * День логіста: маршрути сайту й листи 1С за одну добу — одним списком.
 *
 * Логіст планує день, а не «весь час»: перше питання зранку — що є на
 * сьогодні й на завтра. Досі відповідь збиралася з двох екранів: маршрути
 * сайту лежали списком за весь час (/api/erp/delivery-routes), а листи 1С —
 * у журналі за період у розділі водіїв. Тут вони зведені за київську добу.
 *
 * Лист, з якого маршрут уже зробили, окремим рядком НЕ повертається: він
 * приїжджає всередині маршруту полем `sheet`, щоб картка могла сказати «з
 * листа 1С №…» і показати, чи не привіз обмін нових точок. Звʼязку в базі
 * між ними немає — тільки номер «1С-<номер листа>» (та сама конвенція, що в
 * to-route і в журналі листів).
 *
 * Елемент маршруту — НАДМНОЖИНА того, що віддає списковий GET: картка дня
 * рендерить ті самі AssignDriverBar і RoutePlanPanel, і другий формат даних
 * означав би другий набір багів.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, OFFICE_ROLES } from "@/lib/app/identity";
import { kyivDate, kyivDayStart, kyivDayEnd } from "@/lib/date/kyiv";
import { routeProgress } from "@/lib/routes/progress";

/** Той самий include, що в списковому GET, плюс телеграм водія (як прапорець). */
const ROUTE_INCLUDE = {
  driver: { select: { id: true, name: true, telegramId: true } },
  createdBy: { select: { id: true, name: true } },
  stops: {
    include: {
      salesDocument: { select: { id: true, number: true, status: true, totalAmount: true } },
      counterparty: {
        select: {
          id: true,
          name: true,
          address: true,
          deliveryLat: true,
          deliveryLng: true,
          geoSource: true,
        },
      },
    },
    orderBy: { sequence: "asc" as const },
  },
  _count: { select: { stops: true } },
};

/** Статуси, у яких маршрут займає день водія (планшет покаже лише один). */
const ACTIVE = ["ASSIGNED", "IN_PROGRESS"];

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const dayParam = searchParams.get("day");
  const day = dayParam ?? kyivDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "Дата має бути у форматі РРРР-ММ-ДД" }, { status: 400 });
  }
  const driverId = searchParams.get("driverId") || null;

  // Межі київської доби: маршрут лежить як 00:00 UTC (тобто 03:00 за Києвом),
  // лист 1С приходить зі своїм часом — обидва мають потрапити в свій день.
  const window = { gte: kyivDayStart(day), lte: kyivDayEnd(day) };

  const [routes, sheets, drivers] = await Promise.all([
    prisma.deliveryRoute.findMany({
      where: { date: window, ...(driverId ? { driverId } : {}) },
      include: ROUTE_INCLUDE,
      orderBy: { number: "asc" },
    }),
    prisma.routeSheet.findMany({
      where: { date: window, ...(driverId ? { driverId } : {}) },
      include: {
        driver: { select: { id: true, name: true } },
        stops: {
          // Приховані точки прибрав адмін — у роботу вони не йдуть.
          where: { hidden: false },
          orderBy: { sequence: "asc" },
          include: {
            counterparty: {
              select: { id: true, name: true, deliveryLat: true, deliveryLng: true, geoSource: true },
            },
          },
        },
      },
      orderBy: { number: "asc" },
    }),
    prisma.user.findMany({
      where: { role: "DRIVER" },
      select: { id: true, name: true, telegramId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Лист ↔ маршрут: єдиний звʼязок — номер. Порожнього поля в базі під це
  // немає, і заводити його заради ознаки дорожче (див. журнал листів).
  const routeByNumber = new Map(routes.map((r) => [r.number, r]));

  const routeItems = routes.map((r) => {
    const sheet = r.number.startsWith("1С-")
      ? sheets.find((s) => `1С-${s.number}` === r.number) ?? null
      : null;

    // Що обмін привіз у лист після того, як з нього зробили маршрут. Порівнюємо
    // за накладною й контрагентом, а не за кількістю: to-route склеює точки з
    // однаковою адресою, тож числа й так не збігаються.
    const routeDocs = new Set(r.stops.map((s) => s.salesDocumentId).filter(Boolean));
    const routeCps = new Set(r.stops.map((s) => s.counterpartyId).filter(Boolean));
    const newStops =
      sheet?.stops
        .filter(
          (s) =>
            !(s.salesDocumentId && routeDocs.has(s.salesDocumentId)) &&
            !(s.counterpartyId && routeCps.has(s.counterpartyId))
        )
        .map((s) => ({
          id: s.id,
          name: s.counterparty?.name ?? s.address ?? "Точка",
          address: s.address,
        })) ?? [];

    // Маршрут правили після того, як водієві пішло посилання: у нього на руках
    // старий порядок. Порівняння за кількістю точок — не ідеальне (видалили й
    // додали по одній — не помітимо), але ловить звичайний випадок.
    const linkStale =
      r.linkSentAt != null &&
      (r.linkSentStops != null ? r.stops.length !== r.linkSentStops : false);

    const conflict = ACTIVE.includes(r.status)
      ? routes.find(
          (o) => o.id !== r.id && o.driverId && o.driverId === r.driverId && ACTIVE.includes(o.status)
        )
      : undefined;

    const { telegramId, ...driverRest } = r.driver ?? { telegramId: null };
    return {
      kind: "route" as const,
      ...r,
      day: kyivDate(r.date),
      driver: r.driver ? { ...driverRest, hasTelegram: !!telegramId } : null,
      linkStale,
      progress: routeProgress({
        status: r.status,
        driverId: r.driverId,
        stops: r.stops,
        routeGeometry: r.routeGeometry,
        linkSentAt: r.linkSentAt,
        linkStale,
      }),
      sheet: sheet
        ? { id: sheet.id, number: sheet.number, posted: sheet.posted, stopsCount: sheet.stops.length, newStops }
        : null,
      dayConflict: conflict ? { id: conflict.id, number: conflict.number, status: conflict.status } : null,
    };
  });

  const sheetItems = sheets
    // Лист, з якого маршрут уже зробили, живе всередині картки маршруту.
    .filter((s) => !routeByNumber.has(`1С-${s.number}`))
    .map((s) => {
      // Маршрут сайту на того ж водія в той же день: планшет покаже лише один,
      // і логіст має це знати ДО того, як візьме лист у роботу.
      const existing = s.driverId
        ? routes.find((r) => r.driverId === s.driverId && r.number !== `1С-${s.number}`)
        : undefined;

      return {
        kind: "sheet" as const,
        id: s.id,
        number: s.number,
        day: kyivDate(s.date),
        posted: s.posted,
        driverId: s.driverId,
        driverName: s.driver?.name ?? null,
        driverName1C: s.driverName1C,
        vehicle: s.vehicle,
        distanceKm: s.distanceKm,
        ordersTotal: s.ordersTotal,
        debtsTotal: s.debtsTotal,
        stopsCount: s.stops.length,
        stops: s.stops.map((st) => ({
          id: st.id,
          sequence: st.sequence,
          name: st.counterparty?.name ?? st.address ?? "Точка",
          address: st.address,
          amount: st.amount,
          debtAmount: st.debtAmount,
          hasCoords: st.counterparty?.deliveryLat != null,
          geoSource: st.counterparty?.geoSource ?? null,
        })),
        existingRoute: existing
          ? { id: existing.id, number: existing.number, status: existing.status }
          : null,
        // Чому кнопка «Взяти в роботу» неактивна — рішення приймає сервер, щоб
        // клієнт не повторював умови to-route своїми словами.
        blocker: !s.driverId ? ("NO_DRIVER" as const) : s.stops.length === 0 ? ("NO_STOPS" as const) : null,
      };
    });

  return NextResponse.json({
    day,
    today: kyivDate(new Date()),
    drivers: drivers.map((d) => ({ id: d.id, name: d.name, hasTelegram: !!d.telegramId })),
    items: [...routeItems, ...sheetItems],
  });
}
