/**
 * Маршрутні листи водія: усі, а не лише сьогоднішній.
 *
 * До цього кабінет знав рівно одну адресу дня — «сьогодні», — і водій,
 * якому треба було подивитися вчорашній лист або той, що передали на
 * завтра, впирався в порожній екран. Список дає йому вибір: відкрити
 * будь-який свій маршрут і побачити його точки на карті.
 *
 * З 04.09.2026 у списку ще й ЧУЖІ листи (вимога власника): водій, який
 * підміняє або їде маршрут уперше, мусить бачити, що везуть колеги, і
 * могти скласти собі дорогу по їхньому листу. Свої позначені `mine` і
 * стоять вище — розділ між «моїм» і «чужим» має читатися з першого погляду,
 * бо відмічати можна лише свої.
 *
 * Глибина різна навмисно: свої — два місяці назад, чужі — тиждень. Чужий
 * лист потрібен на сьогодні-завтра («хто ще їде в той бік»), а місячної
 * давнини чужий маршрут — це просто шум у списку, який гортають за кермом.
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

/** Скільки днів назад показуємо свої. Уперед — без межі: завтрашній лист теж свій. */
const DEFAULT_DAYS = 60;
/** Чужі — лише свіжі: тиждень назад і все майбутнє. */
const FOREIGN_DAYS = 7;
const MAX_ITEMS = 200;

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
  /** Чий лист. null — водія 1С ще не зіставили з акаунтом. */
  driverId: string | null;
  driverName: string | null;
  /** Мій лист: лише в такому можна відмічати точки й здавати касу. */
  mine: boolean;
};

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, DRIVER_ROLES);
  if (!auth.ok) return auth.response;
  const me = auth.me;

  const url = new URL(req.url);
  /**
   * Керівник може подивитися список конкретного водія — тоді це рівно його
   * листи, як було завжди. Водій параметр не задає: він або бачить усе
   * (scope=all), або лише своє.
   */
  const asDriverId = me.role === "DRIVER" ? null : url.searchParams.get("driverId");
  const meId = asDriverId || me.userId;
  const onlyMine = url.searchParams.get("scope") === "mine" || !!asDriverId;

  const days = Math.min(180, Math.max(1, Number(url.searchParams.get("days")) || DEFAULT_DAYS));
  const from = kyivDayStart(kyivDate(new Date(Date.now() - days * 86_400_000)));
  const foreignFrom = kyivDayStart(
    kyivDate(new Date(Date.now() - FOREIGN_DAYS * 86_400_000))
  );

  /**
   * Свої за весь період, чужі — лише свіжі. Одним OR, а не двома запитами:
   * інакше довелося б зводити ліміти двох вибірок руками.
   */
  const scopeWhere = onlyMine
    ? { driverId: meId }
    : { OR: [{ driverId: meId }, { date: { gte: foreignFrom } }] };

  const [routes, sheets] = await Promise.all([
    prisma.deliveryRoute.findMany({
      where: {
        ...scopeWhere,
        date: { gte: from },
        status: { in: [...DRIVER_VISIBLE_STATUSES] },
      },
      orderBy: { date: "desc" },
      take: MAX_ITEMS,
      select: {
        id: true,
        number: true,
        date: true,
        status: true,
        vehicleInfo: true,
        totalDistanceKm: true,
        driverId: true,
        driver: { select: { name: true } },
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
      where: { ...scopeWhere, date: { gte: from } },
      orderBy: { date: "desc" },
      take: MAX_ITEMS,
      select: {
        id: true,
        number: true,
        date: true,
        vehicle: true,
        distanceKm: true,
        ordersTotal: true,
        driverId: true,
        driverName1C: true,
        driver: { select: { name: true } },
        stops: {
          where: { hidden: false },
          select: { counterpartyId: true, address: true, amount: true },
        },
      },
    }),
  ]);

  /**
   * Візити тягнемо ДРУГОЮ фазою — коли вже відомо, чиї листи в списку.
   *
   * Прогрес чужого листа рахується по візитах ЙОГО ВЛАСНИКА: у чужому
   * маршруті мої відмітки не з'являться ніколи, і рядок вічно показував би
   * «0 з 18», хоча колега давно все розвіз.
   */
  const ownerIds = [
    ...new Set(
      [...routes, ...sheets].map((r) => r.driverId).filter((id): id is string => !!id)
    ),
  ];
  const visits = ownerIds.length
    ? await prisma.visit.findMany({
        where: { userId: { in: ownerIds }, day: { gte: from } },
        select: { userId: true, day: true, counterpartyId: true },
      })
    : [];

  /**
   * Відмітки розкладаємо по людині й добі, а не по маршруту: візит
   * прив'язаний до клієнта і дня, номера маршруту він не знає. Тому
   * «відмічено» рахуємо перетином клієнтів маршруту з візитами того ж дня —
   * так два рейси в один день не позичають один в одного прогрес.
   */
  const visitedByDay = new Map<string, Set<string>>();
  for (const v of visits) {
    const key = `${v.userId}|${kyivDate(v.day)}`;
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

  /** Скільки з цих клієнтів ВЛАСНИК листа того дня відмітив. */
  const doneCount = (ownerId: string | null, day: string, clientIds: Set<string>): number => {
    if (!ownerId) return 0;
    const visited = visitedByDay.get(`${ownerId}|${day}`);
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
        doneCount(r.driverId, day, points) +
        errands.filter((s) => s.status === "DELIVERED").length,
      amount: round(r.stops.reduce((sum, s) => sum + (s.salesDocument?.totalAmount ?? 0), 0)),
      plannedKm: r.totalDistanceKm,
      driverId: r.driverId,
      driverName: r.driver?.name ?? null,
      mine: r.driverId === meId,
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
      done: doneCount(s.driverId, day, points),
      amount: rows || round(s.ordersTotal),
      plannedKm: s.distanceKm || null,
      driverId: s.driverId,
      driverName: s.driver?.name ?? s.driverName1C ?? null,
      mine: !!s.driverId && s.driverId === meId,
    });
  }

  /**
   * Спадаючий порядок днів: завтрашній лист угорі, далі сьогодні й назад у
   * минуле. Усередині дня свої першими — водій майже завжди відкриває саме
   * свій, а чужий шукає свідомо.
   */
  items.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? 1 : -1;
    if (a.mine !== b.mine) return a.mine ? -1 : 1;
    const byName = (a.driverName ?? "").localeCompare(b.driverName ?? "", "uk");
    return byName || a.number.localeCompare(b.number);
  });

  return NextResponse.json({ today: kyivDate(new Date()), items: items.slice(0, MAX_ITEMS) });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
