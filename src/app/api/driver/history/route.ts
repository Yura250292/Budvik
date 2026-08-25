/**
 * Історія маршрутів водія: що було по днях.
 *
 * За день збирається з трьох джерел, які до цього ніде не сходилися:
 * маршрут (скільки точок планували), відмітки (де він був і скільки
 * грошей забрав) і трек (скільки реально проїхав). Саме зіставлення цих
 * трьох цифр і робить сторінку корисною — окремо кожна нічого не каже.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["DRIVER", "ADMIN", "MANAGER"];
/** Скільки днів історії показуємо за раз. */
const DEFAULT_DAYS = 30;

type DayRow = {
  day: Date;
  distanceKm: number;
  pointsCount: number;
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const url = new URL(req.url);
  const driverId =
    session.user.role === "DRIVER"
      ? session.user.id
      : url.searchParams.get("driverId") || session.user.id;

  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || DEFAULT_DAYS));
  const from = kyivDayStart(kyivDate(new Date(Date.now() - days * 86_400_000)));

  const [sessions, visits, routes, sheets, handovers] = await Promise.all([
    prisma.trackSession.findMany({
      where: { userId: driverId, day: { gte: from } },
      orderBy: { day: "desc" },
      select: { day: true, distanceKm: true, pointsCount: true },
    }),
    prisma.visit.groupBy({
      by: ["day"],
      where: { userId: driverId, day: { gte: from } },
      _count: { _all: true },
      _sum: { collectedAmount: true },
    }),
    prisma.deliveryRoute.findMany({
      where: { driverId, date: { gte: from } },
      select: {
        date: true,
        number: true,
        totalDistanceKm: true,
        totalFuelCost: true,
        _count: { select: { stops: true } },
      },
    }),
    prisma.routeSheet.findMany({
      where: { driverId, date: { gte: from } },
      select: { date: true, number: true, distanceKm: true, ordersTotal: true, debtsTotal: true },
    }),
    prisma.cashHandover.findMany({
      where: { driverId, day: { gte: from } },
      select: { day: true, amount: true, confirmedAt: true, confirmedAmount: true },
    }),
  ]);

  // Ключ — київська доба у вигляді YYYY-MM-DD: дати з різних таблиць
  // приходять із різним часом (лист о 8:00, трек із 00:00), і зіставляти
  // їх напряму не можна.
  const byDay = new Map<
    string,
    {
      day: string;
      trackKm: number;
      trackPoints: number;
      visits: number;
      collected: number;
      routeNumber: string | null;
      plannedStops: number;
      plannedKm: number | null;
      fuelCost: number | null;
      sheet1CKm: number | null;
      /** Скільки водій заявив як здане за цей день, ₴ */
      handed: number;
      /** Скільки з цього офіс уже прийняв, ₴ */
      confirmed: number;
    }
  >();

  const touch = (day: string) => {
    if (!byDay.has(day)) {
      byDay.set(day, {
        day,
        trackKm: 0,
        trackPoints: 0,
        visits: 0,
        collected: 0,
        routeNumber: null,
        plannedStops: 0,
        plannedKm: null,
        fuelCost: null,
        sheet1CKm: null,
        handed: 0,
        confirmed: 0,
      });
    }
    return byDay.get(day)!;
  };

  (sessions as DayRow[]).forEach((s) => {
    const row = touch(kyivDate(s.day));
    row.trackKm = Math.round(s.distanceKm * 10) / 10;
    row.trackPoints = s.pointsCount;
  });

  visits.forEach((v) => {
    const row = touch(kyivDate(v.day));
    row.visits = v._count._all;
    row.collected = v._sum.collectedAmount ?? 0;
  });

  routes.forEach((r) => {
    const row = touch(kyivDate(r.date));
    row.routeNumber = r.number;
    row.plannedStops = r._count.stops;
    row.plannedKm = r.totalDistanceKm;
    row.fuelCost = r.totalFuelCost;
  });

  sheets.forEach((s) => {
    const row = touch(kyivDate(s.date));
    row.sheet1CKm = s.distanceKm || null;
    if (!row.routeNumber) row.routeNumber = s.number;
  });

  handovers.forEach((h) => {
    const row = touch(kyivDate(h.day));
    row.handed += h.amount;
    // Підтверджене рахуємо фактично прийнятою сумою: якщо касир виправив
    // цифру, у водія в історії має стояти те, що реально дійшло.
    if (h.confirmedAt) row.confirmed += h.confirmedAmount ?? h.amount;
  });

  const items = [...byDay.values()]
    .map((row) => ({
      ...row,
      handed: Math.round(row.handed * 100) / 100,
      confirmed: Math.round(row.confirmed * 100) / 100,
    }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));

  return NextResponse.json({
    days,
    items,
    totals: {
      trackKm: Math.round(items.reduce((s, i) => s + i.trackKm, 0) * 10) / 10,
      visits: items.reduce((s, i) => s + i.visits, 0),
      collected: items.reduce((s, i) => s + i.collected, 0),
      handed: Math.round(items.reduce((s, i) => s + i.handed, 0) * 100) / 100,
      workDays: items.filter((i) => i.trackKm > 0 || i.visits > 0).length,
    },
  });
}
