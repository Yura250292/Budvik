/**
 * Маршрутні листи водія: усі, а не лише сьогоднішній.
 *
 * До цього кабінет знав рівно одну адресу дня — «сьогодні», — і водій,
 * якому треба було подивитися вчорашній лист або той, що передали на
 * завтра, впирався в порожній екран. Список дає йому вибір: відкрити
 * будь-який свій маршрут і побачити його точки на карті.
 *
 * Два джерела, як і в resolveDriverDay: маршрут сайту (головне) і лист
 * 1С (майже завжди без точок — там табличної частини немає). Листи без
 * точок у список НЕ потрапляють: відкрити їх однаково нічим, і рядок,
 * який веде в порожнечу, гірший за відсутній рядок.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { DRIVER_VISIBLE_STATUSES } from "@/lib/track/day-stops";
import { requireRoles, DRIVER_ROLES } from "@/lib/app/identity";

export const dynamic = "force-dynamic";

/** Скільки днів назад показуємо. Уперед — без межі: завтрашній лист теж свій. */
const DEFAULT_DAYS = 60;
const MAX_ITEMS = 120;

type Item = {
  /** Ключ для /api/tablet/day?route= — з префіксом джерела */
  key: string;
  source: "DELIVERY_ROUTE" | "ROUTE_SHEET";
  number: string;
  /** Київська доба маршруту, YYYY-MM-DD */
  day: string;
  status: string;
  vehicle: string | null;
  stops: number;
  /** Скільки точок уже відмічено — прогрес видно, не відкриваючи маршрут */
  done: number;
  /** Сума накладних у маршруті, ₴ */
  amount: number;
  plannedKm: number | null;
};

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, DRIVER_ROLES);
  if (!auth.ok) return auth.response;
  const me = auth.me;

  const url = new URL(req.url);
  // Водій завжди дивиться свої листи; керівник може відкрити чужі.
  const driverId =
    me.role === "DRIVER" ? me.userId : url.searchParams.get("driverId") || me.userId;

  const days = Math.min(180, Math.max(1, Number(url.searchParams.get("days")) || DEFAULT_DAYS));
  const from = kyivDayStart(kyivDate(new Date(Date.now() - days * 86_400_000)));

  const [routes, sheets, visits] = await Promise.all([
    prisma.deliveryRoute.findMany({
      where: { driverId, date: { gte: from }, status: { in: [...DRIVER_VISIBLE_STATUSES] } },
      orderBy: { date: "desc" },
      take: MAX_ITEMS,
      select: {
        id: true,
        number: true,
        date: true,
        status: true,
        vehicleInfo: true,
        totalDistanceKm: true,
        stops: {
          select: {
            counterpartyId: true,
            address: true,
            kind: true,
            status: true,
            salesDocument: { select: { totalAmount: true } },
          },
        },
      },
    }),
    prisma.routeSheet.findMany({
      where: { driverId, date: { gte: from } },
      orderBy: { date: "desc" },
      take: MAX_ITEMS,
      select: {
        id: true,
        number: true,
        date: true,
        vehicle: true,
        distanceKm: true,
        ordersTotal: true,
        stops: {
          where: { hidden: false },
          select: { counterpartyId: true, address: true, amount: true },
        },
      },
    }),
    prisma.visit.findMany({
      where: { userId: driverId, day: { gte: from } },
      select: { day: true, counterpartyId: true },
    }),
  ]);

  /**
   * Відмітки розкладаємо по добі, а не по маршруту: візит прив'язаний до
   * клієнта і дня, номера маршруту він не знає. Тому «відмічено» рахуємо
   * перетином клієнтів маршруту з візитами того ж дня — так два рейси в
   * один день не позичають один в одного прогрес.
   */
  const visitedByDay = new Map<string, Set<string>>();
  for (const v of visits) {
    const key = kyivDate(v.day);
    const set = visitedByDay.get(key) ?? new Set<string>();
    set.add(v.counterpartyId);
    visitedByDay.set(key, set);
  }

  /**
   * Скільки точок насправді побачить водій.
   *
   * Не кількість рядків: кілька накладних на одну адресу день зливає в
   * одну точку (mergeByAddress у day-stops.ts). Рахувати рядки означало б
   * писати в списку «18 точок», а після відкриття показувати 15 — і водій
   * шукав би три загублені.
   */
  const mergedClients = (stops: Array<{ counterpartyId: string | null; address: string | null }>) => {
    const keys = new Set<string>();
    stops.forEach((s, i) => {
      keys.add(
        s.counterpartyId ?? (s.address ? `addr:${s.address.trim().toLowerCase()}` : `row:${i}`)
      );
    });
    return keys;
  };

  /** Скільки з цих клієнтів водій того дня відмітив. */
  const doneCount = (day: string, clientIds: Set<string>): number => {
    const visited = visitedByDay.get(day);
    if (!visited) return 0;
    return [...clientIds].filter((id) => visited.has(id)).length;
  };

  const items: Item[] = [];

  for (const r of routes) {
    if (r.stops.length === 0) continue;
    const day = kyivDate(r.date);
    // Бонусна поїздка не має клієнта, тож у візитах її не знайти — свій
    // стан вона несе в самій точці. Вона ж ніколи не зливається з сусідами.
    const errands = r.stops.filter((s) => s.kind !== "DELIVERY");
    const points = mergedClients(r.stops.filter((s) => s.kind === "DELIVERY"));

    items.push({
      key: `dr:${r.id}`,
      source: "DELIVERY_ROUTE",
      number: r.number,
      day,
      status: r.status,
      vehicle: r.vehicleInfo,
      stops: points.size + errands.length,
      done:
        doneCount(day, points) + errands.filter((s) => s.status === "DELIVERED").length,
      amount: round(r.stops.reduce((sum, s) => sum + (s.salesDocument?.totalAmount ?? 0), 0)),
      plannedKm: r.totalDistanceKm,
    });
  }

  for (const s of sheets) {
    if (s.stops.length === 0) continue;
    const day = kyivDate(s.date);
    const points = mergedClients(s.stops);
    /**
     * Суму беремо з рядків, а не з шапки листа: ordersTotal з 1С у базі
     * порожній у ВСІХ листів (перевірено 03.09), і картка мовчки писала б
     * «0 ₴» там, де водій везе на 200 тисяч.
     */
    const rows = round(s.stops.reduce((sum, x) => sum + x.amount, 0));

    items.push({
      key: `rs:${s.id}`,
      source: "ROUTE_SHEET",
      number: s.number,
      day,
      status: "SHEET_1C",
      vehicle: s.vehicle,
      stops: points.size,
      done: doneCount(day, points),
      amount: rows || round(s.ordersTotal),
      plannedKm: s.distanceKm || null,
    });
  }

  // Спадаючий порядок: завтрашній лист угорі, далі сьогодні й назад у
  // минуле. Водій майже завжди відкриває один із перших двох рядків.
  items.sort((a, b) => (a.day === b.day ? a.number.localeCompare(b.number) : a.day < b.day ? 1 : -1));

  return NextResponse.json({ today: kyivDate(new Date()), items: items.slice(0, MAX_ITEMS) });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
