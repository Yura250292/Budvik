/**
 * Список маршрутних листів за період — журнал того, що прийшло з 1С.
 *
 * На відміну від /payroll, сюди потрапляють і листи без прив'язаного
 * водія: саме тут видно, що документ прийшов, але зарплату за нього ще
 * нема кому нарахувати.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod } from "@/lib/analytics/period";
import { kyivDate } from "@/lib/date/kyiv";
import { calculateRouteSheetPay } from "@/lib/drivers/payroll";
import { getRates, resolveStops, sheetToFacts } from "@/lib/drivers/payroll-facts";

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
  const restrictToDriver = isFullAccess ? driverFilter : session.user.id;

  const [sheets, rates] = await Promise.all([
    prisma.routeSheet.findMany({
      where: {
        date: { gte: period.from, lte: period.to },
        // Водій бачить лише свої; адмін — усі, разом із нерозмапленими.
        ...(restrictToDriver ? { driverId: restrictToDriver } : {}),
      },
      orderBy: [{ date: "desc" }, { number: "desc" }],
      select: {
        id: true,
        number: true,
        date: true,
        posted: true,
        driverId: true,
        driverName1C: true,
        driverExternalId1C: true,
        vehicle: true,
        distanceKm: true,
        ordersTotal: true,
        debtsTotal: true,
        driver: { select: { name: true } },
        stops: {
          orderBy: { sequence: "asc" as const },
          select: {
            id: true,
            sequence: true,
            counterpartyId: true,
            salesDocumentId: true,
            address: true,
            amount: true,
            debtAmount: true,
            counterparty: {
              select: {
                id: true,
                name: true,
                deliveryAddress: true,
                address: true,
                deliveryLat: true,
                deliveryLng: true,
                deliveryZone: true,
              },
            },
          },
        },
      },
    }),
    getRates(),
  ]);

  const rows = sheets.map((sheet) => {
    const stops = resolveStops(sheet);
    // Непроведений документ — чернетка в 1С, за неї не платять; показуємо
    // нуль, щоб не створювати враження заробітку.
    const pay = sheet.posted
      ? calculateRouteSheetPay(sheetToFacts(sheet), rates)
      : null;

    return {
      id: sheet.id,
      number: sheet.number,
      day: kyivDate(sheet.date),
      posted: sheet.posted,
      driverId: sheet.driverId,
      driverName: sheet.driver?.name ?? null,
      driverName1C: sheet.driverName1C,
      vehicle: sheet.vehicle,
      distanceKm: sheet.distanceKm,
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
