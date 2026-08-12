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

  const rows = sheets
    .sort((a, b) => b.date.getTime() - a.date.getTime() || b.number.localeCompare(a.number))
    .map((sheet) => {
      const stops = resolveStops(sheet);
      // Непроведений документ — чернетка в 1С, за неї не платять; показуємо
      // нуль, щоб не створювати враження заробітку.
      const pay = sheet.posted ? calculateRouteSheetPay(sheetToFacts(sheet), rates) : null;

      return {
        id: sheet.id,
        source: sheet.source,
        number: sheet.number,
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
