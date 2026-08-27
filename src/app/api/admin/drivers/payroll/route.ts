/**
 * Зарплата водіїв за період.
 *
 * Одна відповідь на всю вкладку: зведення по водіях, розгортка кожного
 * листа з рядками нарахувань і ручні надбавки. Так само влаштований
 * sales-analytics/summary — один спінер замість трьох.
 *
 * Листи без прив'язаного водія сюди не потрапляють (нема кому платити),
 * але їх кількість повертається окремо: банер у UI веде до «Налаштувань»,
 * де їх мапнуть на акаунти.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parsePeriod } from "@/lib/analytics/period";
import { calculateDriverPeriod } from "@/lib/drivers/payroll";
import { getRates, loadBonuses, loadPayrollRows, sheetToFacts } from "@/lib/drivers/payroll-facts";
import { resolveIdentity } from "@/lib/app/identity";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const me = await resolveIdentity(req);
  if (!me) return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });

  const role = me.role;
  const isFullAccess = FULL_ACCESS_ROLES.includes(role);
  if (!isFullAccess && role !== "DRIVER") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = parsePeriod(searchParams);

  // Водій бачить лише себе, і параметром це не обійти.
  const driverFilter = searchParams.get("driverId");
  const restrictToDriver = isFullAccess ? driverFilter : me.userId;

  const [sheets, bonuses, rates, drivers, unmappedCount] = await Promise.all([
    loadPayrollRows(period.from, period.to, restrictToDriver),
    loadBonuses(period.from, period.to, restrictToDriver),
    getRates(),
    prisma.user.findMany({
      where: { role: "DRIVER", ...(restrictToDriver ? { id: restrictToDriver } : {}) },
      select: { id: true, name: true, driver1CExternalId: true },
      orderBy: { name: "asc" },
    }),
    prisma.routeSheet.count({
      where: { date: { gte: period.from, lte: period.to }, posted: true, driverId: null },
    }),
  ]);

  // Групуємо по водію: у маршруті сайту driverId ставить логіст, у листі
  // 1С — прийом з обміну за мапінгом.
  const sheetsByDriver = new Map<string, ReturnType<typeof sheetToFacts>[]>();
  for (const sheet of sheets) {
    if (!sheet.driverId) continue;
    const list = sheetsByDriver.get(sheet.driverId) ?? [];
    list.push(sheetToFacts(sheet));
    sheetsByDriver.set(sheet.driverId, list);
  }

  const bonusesByDriver = new Map<string, typeof bonuses>();
  for (const bonus of bonuses) {
    const list = bonusesByDriver.get(bonus.driverId) ?? [];
    list.push(bonus);
    bonusesByDriver.set(bonus.driverId, list);
  }

  // Водії без жодного листа й надбавки в списку не потрібні — вони не
  // працювали в цьому періоді, і порожній рядок лише заважає читати.
  const rows = drivers
    .filter((d) => sheetsByDriver.has(d.id) || bonusesByDriver.has(d.id))
    .map((driver) => {
      const payroll = calculateDriverPeriod(
        driver.id,
        sheetsByDriver.get(driver.id) ?? [],
        bonusesByDriver.get(driver.id) ?? [],
        rates
      );

      return {
        driverId: driver.id,
        driverName: driver.name,
        mapped: !!driver.driver1CExternalId,
        sheetsCount: payroll.sheetsCount,
        totalKm: payroll.totalKm,
        cityPoints: payroll.cityPoints,
        oblastPoints: payroll.oblastPoints,
        turnoverBase: payroll.turnoverBase,
        sheetsTotal: payroll.sheetsTotal,
        bonusesTotal: payroll.bonusesTotal,
        total: payroll.total,
        sheets: payroll.sheets.map((s) => ({
          routeSheetId: s.facts.routeSheetId,
          source: s.facts.source ?? "SHEET_1C",
          number: s.facts.number,
          day: s.facts.day,
          distanceKm: s.facts.distanceKm,
          kmSource: s.facts.kmSource ?? "SHEET",
          plannedKm: s.facts.plannedKm ?? null,
          cityPoints: s.facts.cityPoints,
          oblastPoints: s.facts.oblastPoints,
          unknownZonePoints: s.facts.unknownZonePoints ?? 0,
          ordersTotal: s.facts.ordersTotal,
          debtsTotal: s.facts.debtsTotal,
          total: s.total,
          lines: s.lines,
        })),
        bonuses: (bonusesByDriver.get(driver.id) ?? []).map((b) => ({
          id: b.id,
          day: b.day,
          amount: b.amount,
          reason: b.reason,
          createdByName: b.createdByName,
        })),
      };
    })
    .sort((a, b) => b.total - a.total);

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    canEdit: isFullAccess,
    rates,
    unmappedSheets: unmappedCount,
    rows,
    totals: {
      sheetsCount: rows.reduce((s, r) => s + r.sheetsCount, 0),
      totalKm: rows.reduce((s, r) => s + r.totalKm, 0),
      sheetsTotal: rows.reduce((s, r) => s + r.sheetsTotal, 0),
      bonusesTotal: rows.reduce((s, r) => s + r.bonusesTotal, 0),
      total: rows.reduce((s, r) => s + r.total, 0),
    },
  });
}
