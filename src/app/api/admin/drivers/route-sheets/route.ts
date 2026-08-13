/**
 * Журнал маршрутних листів за період — з обох джерел.
 *
 * Головне джерело — маршрути планувальника сайту (проби 1С довели, що
 * Документ.МаршрутнийЛист — лише шапка без точок і кілометражу). Листи 1С
 * показуються запасно: для днів без маршруту сайту і для нерозмаплених
 * водіїв — саме тут видно, що документ прийшов, але зарплату за нього ще
 * нема кому нарахувати.
 *
 * PATCH зберігає фактичний пробіг маршруту (actualKm): у 1С кілометраж не
 * живе, тому адмін вводить його сюди з паперового листа чи одометра. Поки
 * поле порожнє, розрахунок бере планові км OSRM.
 *
 * DELETE прибирає маршрут сайту — тестові й помилково створені. Листи 1С
 * не видаляємо: прийом іде за externalId, тож наступний обмін привів би
 * документ назад, і кнопка виглядала б зламаною.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod } from "@/lib/analytics/period";
import { kyivDate } from "@/lib/date/kyiv";
import { calculateRouteSheetPay } from "@/lib/drivers/payroll";
import { getRates, loadPayrollRows, resolveStops, sheetToFacts } from "@/lib/drivers/payroll-facts";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const role = session.user.role;
  const isFullAccess = FULL_ACCESS_ROLES.includes(role);
  if (!isFullAccess && role !== "DRIVER") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = parsePeriod(searchParams);
  const driverFilter = searchParams.get("driverId");
  // Водій бачить лише свої; адмін — усі, разом із нерозмапленими.
  const restrictToDriver = isFullAccess ? driverFilter : session.user.id;

  const [sheets, rates] = await Promise.all([
    loadPayrollRows(period.from, period.to, restrictToDriver, { includeUnposted: true }),
    getRates(),
  ]);

  // Які листи вже перетворені на маршрут сайту. Номер маршруту несе номер
  // листа — окремого поля-зв'язку немає, і заводити його заради однієї
  // ознаки дорожче, ніж один запит по номерах.
  const sheetNumbers = sheets.filter((s) => s.source === "SHEET_1C").map((s) => `1С-${s.number}`);
  const converted = sheetNumbers.length
    ? await prisma.deliveryRoute.findMany({
        where: { number: { in: sheetNumbers } },
        select: { id: true, number: true, status: true },
      })
    : [];
  const convertedByNumber = new Map(converted.map((r) => [r.number, r]));

  const rows = sheets
    .sort((a, b) => b.date.getTime() - a.date.getTime() || b.number.localeCompare(a.number))
    .map((sheet) => {
      const stops = resolveStops(sheet);
      // Непроведений документ — чернетка в 1С, за неї не платять; показуємо
      // нуль, щоб не створювати враження заробітку.
      const pay = sheet.posted ? calculateRouteSheetPay(sheetToFacts(sheet), rates) : null;

      const asRoute = sheet.source === "SHEET_1C"
        ? (convertedByNumber.get(`1С-${sheet.number}`) ?? null)
        : null;

      return {
        id: sheet.id,
        source: sheet.source,
        number: sheet.number,
        /** Маршрут сайту, створений із цього листа: null — ще не створено. */
        convertedRoute: asRoute,
        day: kyivDate(sheet.date),
        posted: sheet.posted,
        driverId: sheet.driverId,
        driverName: sheet.driverName,
        driverName1C: sheet.driverName1C,
        vehicle: sheet.vehicle,
        distanceKm: sheet.distanceKm,
        plannedKm: sheet.plannedKm,
        actualKm: sheet.actualKm,
        ordersTotal: sheet.ordersTotal,
        debtsTotal: sheet.debtsTotal,
        stopsCount: stops.length,
        paidPoints: stops.filter((s) => s.paid).length,
        unknownZonePoints: stops.filter((s) => s.paid && s.zoneSource === "UNKNOWN").length,
        total: pay?.total ?? 0,
        lines: pay?.lines ?? [],
        stops,
      };
    });

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    canEdit: isFullAccess,
    // Видалення вужче за редагування: воно міняє нараховане за період
    // мовчки, тож лишається за адміністратором.
    canDelete: role === "ADMIN",
    rates,
    rows,
  });
}

/** Фактичний пробіг маршруту сайту. null — повернутися до планових км. */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!FULL_ACCESS_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const routeId = typeof body?.routeId === "string" ? body.routeId : null;
  const actualKm = body?.actualKm;
  if (!routeId || (actualKm !== null && !(typeof actualKm === "number" && actualKm >= 0 && Number.isFinite(actualKm)))) {
    return NextResponse.json(
      { error: "Потрібні routeId і actualKm (число ≥ 0 або null)" },
      { status: 400 }
    );
  }

  try {
    await prisma.deliveryRoute.update({
      where: { id: routeId },
      data: { actualKm },
    });
  } catch {
    return NextResponse.json({ error: "Маршрут не знайдено" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * Видалення маршруту сайту — тестові й помилково створені.
 *
 * Тільки ADMIN: маршрут — первинне джерело зарплати водія, і його зникнення
 * мовчки змінює нараховане за період. Менеджеру вистачає правки точок.
 *
 * Листи 1С не чіпаємо: вони приходять обміном за externalId, і видалений
 * документ повернувся б наступною синхронізацією. Прибирати треба в 1С.
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Видаляти маршрути може лише адміністратор" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const routeId = searchParams.get("routeId");
  if (!routeId) {
    return NextResponse.json({ error: "Потрібен routeId" }, { status: 400 });
  }

  const route = await prisma.deliveryRoute.findUnique({
    where: { id: routeId },
    select: { id: true, number: true, stops: { select: { id: true } } },
  });
  if (!route) {
    return NextResponse.json({ error: "Маршрут не знайдено" }, { status: 404 });
  }

  const stopIds = route.stops.map((s) => s.id);

  // Visit.deliveryStopId — звичайне поле, а не зв'язок, тож каскад його не
  // прибирає: без цього відмітки водія лишилися б висіти на неіснуючих
  // точках. Сам візит зберігаємо — це свідчення, що людина там була;
  // рвемо лише посилання на видалений маршрут.
  await prisma.$transaction([
    ...(stopIds.length > 0
      ? [
          prisma.visit.updateMany({
            where: { deliveryStopId: { in: stopIds } },
            data: { deliveryStopId: null },
          }),
        ]
      : []),
    prisma.deliveryStop.deleteMany({ where: { deliveryRouteId: routeId } }),
    prisma.deliveryRoute.delete({ where: { id: routeId } }),
  ]);

  return NextResponse.json({ ok: true, number: route.number });
}
