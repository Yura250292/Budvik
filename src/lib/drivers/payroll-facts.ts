/**
 * Факти для розрахунку зарплати водіїв: з бази — у чисті числа.
 *
 * Тут живе все, що потребує Prisma: вибірка листів за період, дедуплікація
 * точок вигрузки і визначення зони кожної точки. Сам розрахунок — у
 * payroll.ts, який про базу нічого не знає (той самий поділ, що
 * motivation/period-facts.ts ↔ motivation/engine.ts).
 *
 * Джерел листів ДВА, і вони не рівноцінні (той самий порядок, що в
 * track/day-stops.ts, і з тієї ж причини):
 *
 *   DeliveryRoute (сайт) — головне. Проби 1С (коміти fe9debc, 2c8591e)
 *   довели, що Документ.МаршрутнийЛист — лише шапка: точки складають
 *   вручну під час друку, кілометраж заповнений у 2 листах з 40. Тому
 *   логіст формує маршрут у планувальнику, водій виконує на планшеті,
 *   а зарплата рахується з цього маршруту: суми — з накладних точок,
 *   борги — з відміток інкасації (Visit.collectedAmount), пробіг —
 *   введений адміном actualKm або, поки його немає, плановий OSRM.
 *
 *   RouteSheet (1С) — запасне: береться лише для днів, на які в водія
 *   немає маршруту сайту. Зворотний порядок означав би, що порожня
 *   шапка з 1С перекриває реальний маршрут.
 *
 * Зона точки НЕ зберігається як обчислений факт: адмін може перемкнути
 * місто/область заднім числом, і зарплата за минулий місяць має
 * перерахуватися сама. Збережений кеш довелося б інвалідовувати. Ручні ж
 * override'и (DeliveryStop.zoneOverride, Counterparty.deliveryZone) — це не
 * кеш, а рішення людини, і вони зберігаються.
 *
 * Оплачується лише передана робота: маршрут у статусі PLANNED — чернетка
 * логіста, водій її не бачив, і ставка за неї не нараховується.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayEnd } from "@/lib/date/kyiv";
import { addressKey, classifyZone, type ZoneSource } from "./zone";
import {
  DEFAULT_RATES,
  type DriverBonusInput,
  type PayrollRates,
  type RouteSheetFacts,
} from "./payroll";

/** Одна точка листа з визначеною зоною — для деталі маршрутного листа. */
export interface StopWithZone {
  id: string;
  sequence: number;
  counterpartyId: string | null;
  counterpartyName: string | null;
  salesDocumentId: string | null;
  address: string | null;
  amount: number;
  debtAmount: number;
  zone: "CITY" | "OBLAST";
  zoneSource: ZoneSource;
  /** Ключ дедуплікації: рядки з однаковим ключем оплачуються як одна точка */
  pointKey: string;
  /** true — саме цей рядок оплачується; решта дублів адреси йдуть безкоштовно */
  paid: boolean;
  /** DELIVERY / PICKUP / ERRAND — бонусні поїздки видно в деталі окремо */
  kind: "DELIVERY" | "PICKUP" | "ERRAND";
  /** Назва бонусної поїздки; для доставки порожня */
  title: string | null;
  /** Ручна ціна саме за цю точку, ₴ — перебиває тариф місто/область */
  payOverride: number | null;
}

type SheetRow = {
  id: string;
  /** SITE — маршрут планувальника (id = DeliveryRoute.id), SHEET_1C — лист з обміну */
  source: "SITE" | "SHEET_1C";
  number: string;
  date: Date;
  driverId: string | null;
  driverName: string | null;
  driverName1C: string | null;
  driverExternalId1C: string | null;
  vehicle: string | null;
  /** Ефективний пробіг для розрахунку: actualKm ?? plannedKm ?? 0 */
  distanceKm: number;
  /** Плановий пробіг OSRM (лише SITE) — підказка, поки факт не введено */
  plannedKm: number | null;
  /** Фактичний пробіг, введений адміном (лише SITE) */
  actualKm: number | null;
  ordersTotal: number;
  debtsTotal: number;
  posted: boolean;
  stops: {
    id: string;
    sequence: number;
    counterpartyId: string | null;
    salesDocumentId: string | null;
    address: string | null;
    amount: number;
    debtAmount: number;
    /** Лише в маршрутів сайту; у листах 1С точка завжди звичайна доставка */
    kind?: "DELIVERY" | "PICKUP" | "ERRAND";
    title?: string | null;
    payOverride?: number | null;
    zoneOverride?: "CITY" | "OBLAST" | null;
    counterparty: {
      id: string;
      name: string;
      deliveryAddress: string | null;
      address: string | null;
      deliveryLat: number | null;
      deliveryLng: number | null;
      deliveryZone: "CITY" | "OBLAST" | null;
    } | null;
  }[];
};

/** Що саме вибираємо з бази — один раз, щоб типи не розповзалися. */
const SHEET_SELECT = {
  id: true,
  number: true,
  date: true,
  driverId: true,
  driver: { select: { name: true } },
  driverName1C: true,
  driverExternalId1C: true,
  vehicle: true,
  distanceKm: true,
  ordersTotal: true,
  debtsTotal: true,
  posted: true,
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
} as const;

/**
 * Точки листа із зонами й позначкою, які з них оплачуються.
 *
 * Дедуплікація за нормалізованою адресою: три накладні на ту саму адресу —
 * одна оплачена точка. Оплачується перша за порядком; решта лишаються в
 * списку з paid=false, щоб у деталі було видно, чому їх не порахували.
 */
export function resolveStops(sheet: SheetRow): StopWithZone[] {
  const seen = new Set<string>();

  return sheet.stops.map((stop) => {
    const cp = stop.counterparty;
    const kind = stop.kind ?? "DELIVERY";
    const isErrand = kind !== "DELIVERY";
    // Адреса рядка з 1С пріоритетніша за картку клієнта: у листі вона
    // стосується саме цієї доставки, а в картці — остання відома.
    const address = stop.address?.trim() || cp?.deliveryAddress?.trim() || cp?.address?.trim() || null;

    const { zone, source } = classifyZone({
      // Зона точки б'є зону контрагента: той самий клієнт сьогодні в місті,
      // а завтра на заміській філії, і платити треба за фактом виїзду.
      override: stop.zoneOverride ?? cp?.deliveryZone ?? null,
      lat: cp?.deliveryLat ?? null,
      lng: cp?.deliveryLng ?? null,
      address,
    });

    // Бонусна поїздка не дедуплікується за адресою: «забрати ремонт» і
    // доставка за тією ж адресою — дві різні справи, обидві оплачувані.
    const pointKey = isErrand
      ? `extra:${stop.id}`
      : addressKey(address, stop.counterpartyId, stop.id);
    const paid = !seen.has(pointKey);
    if (paid) seen.add(pointKey);

    return {
      id: stop.id,
      sequence: stop.sequence,
      counterpartyId: stop.counterpartyId,
      counterpartyName: cp?.name ?? null,
      salesDocumentId: stop.salesDocumentId,
      address,
      amount: stop.amount,
      debtAmount: stop.debtAmount,
      zone,
      zoneSource: source,
      pointKey,
      paid,
      kind,
      title: stop.title ?? null,
      payOverride: stop.payOverride ?? null,
    };
  });
}

/** Лист → факти для калькулятора. */
export function sheetToFacts(sheet: SheetRow): RouteSheetFacts {
  const allPaid = resolveStops(sheet).filter((s) => s.paid);

  // Точка з ручною ціною виходить із тарифної сітки: вона вже має свою суму,
  // і рахувати її ще й як «точку в місті» означало б заплатити двічі.
  // Бонусна поїздка без указаної ціни — теж не тарифна точка: платити за
  // «відвезти на пошту» 25 ₴ як за вигрузку неправильно, тому вона просто
  // не потрапляє в оплату, поки логіст не проставить суму.
  const stops = allPaid.filter((s) => s.kind === "DELIVERY" && s.payOverride == null);
  const paidExtras = allPaid
    .filter((s) => s.payOverride != null && s.payOverride !== 0)
    .map((s) => ({
      label: s.title ?? s.counterpartyName ?? s.address ?? "Точка",
      amount: s.payOverride as number,
    }));

  return {
    routeSheetId: sheet.id,
    source: sheet.source,
    number: sheet.number,
    day: kyivDate(sheet.date),
    distanceKm: sheet.distanceKm,
    kmSource:
      sheet.source === "SHEET_1C"
        ? "SHEET"
        : sheet.actualKm != null
          ? "MANUAL"
          : sheet.plannedKm != null
            ? "PLAN"
            : "NONE",
    plannedKm: sheet.plannedKm,
    cityPoints: stops.filter((s) => s.zone === "CITY").length,
    oblastPoints: stops.filter((s) => s.zone === "OBLAST").length,
    unknownZonePoints: stops.filter((s) => s.zoneSource === "UNKNOWN").length,
    paidExtras,
    ordersTotal: sheet.ordersTotal,
    debtsTotal: sheet.debtsTotal,
  };
}

/**
 * Маршрутні листи 1С за період — запасне джерело.
 *
 * За замовчуванням лише проведені: непроведений документ у 1С — чернетка,
 * за неї не платять. Журнал листів передає includeUnposted, щоб показати
 * чернетку з бейджем. Листи без прив'язаного водія (driverId = null) не
 * потрапляють у зарплату — їх видно окремим списком у «Налаштуваннях».
 */
export async function loadSheets(
  from: Date,
  to: Date,
  driverId?: string | null,
  opts?: { includeUnposted?: boolean }
): Promise<SheetRow[]> {
  const rows = await prisma.routeSheet.findMany({
    where: {
      date: { gte: from, lte: to },
      ...(opts?.includeUnposted ? {} : { posted: true }),
      ...(driverId ? { driverId } : {}),
    },
    orderBy: [{ date: "asc" }, { number: "asc" }],
    select: SHEET_SELECT,
  });

  return rows.map((s) => ({
    ...s,
    source: "SHEET_1C" as const,
    driverName: s.driver?.name ?? null,
    plannedKm: null,
    actualKm: null,
  }));
}

/** Що вибираємо з маршруту сайту — дзеркало SHEET_SELECT для DeliveryRoute. */
const ROUTE_SELECT = {
  id: true,
  number: true,
  date: true,
  driverId: true,
  driver: { select: { name: true } },
  vehicleInfo: true,
  totalDistanceKm: true,
  actualKm: true,
  stops: {
    orderBy: { sequence: "asc" as const },
    select: {
      id: true,
      sequence: true,
      counterpartyId: true,
      salesDocumentId: true,
      address: true,
      kind: true,
      title: true,
      payOverride: true,
      zoneOverride: true,
      salesDocument: { select: { totalAmount: true } },
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
} as const;

/**
 * Маршрути сайту за період у вигляді листів — головне джерело.
 *
 * Межа періоду ріжеться кінцем сьогоднішньої доби: маршрут, спланований
 * на завтра, ще не виконаний, і нараховувати за нього ставку зарано.
 * Скасовані маршрути не платяться.
 *
 * Борги: у паперовому листі 1С це рядки «Оплата заборгованості» — гроші,
 * які водій забирає за попередні доставки. На сайті цим свідченням є
 * відмітки інкасації (Visit.collectedAmount) за день маршруту: вони
 * зменшують базу відсотка так само, як рядки боргу в листі. Візит
 * прив'язується до маршруту через deliveryStopId, далі за контрагентом
 * серед точок, а «поза планом» — до першого маршруту дня, щоб при двох
 * виїздах сума не порахувалася двічі.
 */
export async function loadRouteRows(
  from: Date,
  to: Date,
  driverId?: string | null
): Promise<SheetRow[]> {
  const todayEnd = kyivDayEnd(kyivDate(new Date()));
  const cappedTo = to <= todayEnd ? to : todayEnd;
  if (from > cappedTo) return [];

  const routes = await prisma.deliveryRoute.findMany({
    where: {
      date: { gte: from, lte: cappedTo },
      // Чернетка логіста (PLANNED) — ще не робота: водій її навіть не бачив.
      // Скасовані теж не платяться.
      status: { in: ["ASSIGNED", "IN_PROGRESS", "COMPLETED"] },
      ...(driverId ? { driverId } : {}),
    },
    orderBy: [{ date: "asc" }, { number: "asc" }],
    select: ROUTE_SELECT,
  });
  if (routes.length === 0) return [];

  const driverIds = [...new Set(routes.map((r) => r.driverId).filter((x): x is string => !!x))];
  const visits = driverIds.length
    ? await prisma.visit.findMany({
        where: {
          userId: { in: driverIds },
          day: { gte: from, lte: cappedTo },
          collectedAmount: { gt: 0 },
        },
        select: {
          userId: true,
          day: true,
          counterpartyId: true,
          deliveryStopId: true,
          collectedAmount: true,
        },
      })
    : [];

  // Маршрути одного водія за день — щоб візит ліг рівно в один із них.
  const routesByDay = new Map<string, typeof routes>();
  for (const r of routes) {
    if (!r.driverId) continue;
    const key = `${r.driverId}|${kyivDate(r.date)}`;
    routesByDay.set(key, [...(routesByDay.get(key) ?? []), r]);
  }

  // routeId → (counterpartyId → зібрано, ₴). Ключ display-рівня: перша точка
  // цього контрагента в маршруті покаже суму, а debtsTotal — їх сума.
  const collectedByRoute = new Map<string, Map<string, number>>();
  const add = (routeId: string, counterpartyId: string, amount: number) => {
    const m = collectedByRoute.get(routeId) ?? new Map<string, number>();
    m.set(counterpartyId, (m.get(counterpartyId) ?? 0) + amount);
    collectedByRoute.set(routeId, m);
  };

  for (const v of visits) {
    const dayRoutes = routesByDay.get(`${v.userId}|${kyivDate(v.day)}`);
    if (!dayRoutes?.length || !v.collectedAmount) continue;

    const byStop = v.deliveryStopId
      ? dayRoutes.find((r) => r.stops.some((s) => s.id === v.deliveryStopId))
      : undefined;
    const byClient =
      byStop ?? dayRoutes.find((r) => r.stops.some((s) => s.counterpartyId === v.counterpartyId));
    add((byClient ?? dayRoutes[0]).id, v.counterpartyId, v.collectedAmount);
  }

  return routes.map((r) => {
    const collected = collectedByRoute.get(r.id) ?? new Map<string, number>();
    const seenClient = new Set<string>();

    const stops = r.stops.map((s) => {
      // Сума інкасації клеїться до ПЕРШОЇ точки контрагента: візит один на
      // клієнта за день, і дублювати його по рядках не можна.
      let debtAmount = 0;
      if (s.counterpartyId && !seenClient.has(s.counterpartyId)) {
        seenClient.add(s.counterpartyId);
        debtAmount = collected.get(s.counterpartyId) ?? 0;
      }
      return {
        id: s.id,
        sequence: s.sequence,
        counterpartyId: s.counterpartyId,
        salesDocumentId: s.salesDocumentId,
        address: s.address,
        amount: s.salesDocument?.totalAmount ?? 0,
        debtAmount,
        kind: s.kind,
        title: s.title,
        payOverride: s.payOverride,
        zoneOverride: s.zoneOverride,
        counterparty: s.counterparty,
      };
    });

    // debtsTotal — ВСЯ інкасація дня, включно з «поза планом»: водій забрав
    // борг у клієнта, якого не було в маршруті — база відсотка все одно менша.
    const debtsTotal = [...collected.values()].reduce((sum, x) => sum + x, 0);

    return {
      id: r.id,
      source: "SITE" as const,
      number: r.number,
      date: r.date,
      driverId: r.driverId,
      driverName: r.driver?.name ?? null,
      driverName1C: null,
      driverExternalId1C: null,
      vehicle: r.vehicleInfo,
      distanceKm: r.actualKm ?? r.totalDistanceKm ?? 0,
      plannedKm: r.totalDistanceKm,
      actualKm: r.actualKm,
      ordersTotal: stops.reduce((sum, s) => sum + s.amount, 0),
      debtsTotal,
      posted: true,
      stops,
    };
  });
}

/**
 * Об'єднане джерело листів: маршрути сайту + листи 1С за дні без маршруту.
 *
 * Лист 1С відкидається, лише якщо в ТОГО САМОГО водія на ТОЙ САМИЙ день є
 * маршрут сайту — інакше порожня шапка з обміну дублювала б реальний
 * маршрут і за той самий день нарахувалися б дві ставки за пробіг.
 * Неприв'язані листи (driverId = null) проходять завжди: зарплати вони
 * не творять, але журнал має їх показувати.
 */
export async function loadPayrollRows(
  from: Date,
  to: Date,
  driverId?: string | null,
  opts?: { includeUnposted?: boolean }
): Promise<SheetRow[]> {
  const [routes, sheets] = await Promise.all([
    loadRouteRows(from, to, driverId),
    loadSheets(from, to, driverId, opts),
  ]);

  const siteDays = new Set(
    routes.filter((r) => r.driverId).map((r) => `${r.driverId}|${kyivDate(r.date)}`)
  );
  const backup = sheets.filter(
    (s) => !s.driverId || !siteDays.has(`${s.driverId}|${kyivDate(s.date)}`)
  );

  return [...routes, ...backup].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.number.localeCompare(b.number)
  );
}

/** Факти по водію за період — вхід для calculateDriverPeriod. */
export async function buildDriverFacts(
  driverId: string,
  from: Date,
  to: Date
): Promise<RouteSheetFacts[]> {
  const rows = await loadPayrollRows(from, to, driverId);
  return rows.map(sheetToFacts);
}

/** Ручні надбавки за період. */
export async function loadBonuses(
  from: Date,
  to: Date,
  driverId?: string | null
): Promise<(DriverBonusInput & { driverId: string; createdByName: string | null })[]> {
  const rows = await prisma.driverBonus.findMany({
    where: {
      date: { gte: from, lte: to },
      ...(driverId ? { driverId } : {}),
    },
    orderBy: { date: "asc" },
    select: {
      id: true,
      driverId: true,
      date: true,
      amount: true,
      reason: true,
      createdBy: { select: { name: true } },
    },
  });

  return rows.map((b) => ({
    id: b.id,
    driverId: b.driverId,
    day: kyivDate(b.date),
    amount: b.amount,
    reason: b.reason,
    createdByName: b.createdBy?.name ?? null,
  }));
}

/**
 * Чинні ставки. Рядок один на всю систему; якщо його ще немає — створюємо
 * з дефолтами, щоб екран не падав на порожній базі (той самий підхід, що
 * VEHICLE_DEFAULTS у аналітиці торгових).
 */
export async function getRates(): Promise<PayrollRates> {
  const row = await prisma.driverPayrollRates.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });

  return {
    kmTier1Max: row.kmTier1Max,
    kmTier1Rate: row.kmTier1Rate,
    kmTier2Max: row.kmTier2Max,
    kmTier2Rate: row.kmTier2Rate,
    kmTier3Rate: row.kmTier3Rate,
    cityPointRate: row.cityPointRate,
    oblastPointRate: row.oblastPointRate,
    turnoverPercent: row.turnoverPercent,
  };
}

export { DEFAULT_RATES };
export type { SheetRow };
