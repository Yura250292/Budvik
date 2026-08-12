/**
 * Факти для розрахунку зарплати водіїв: з бази — у чисті числа.
 *
 * Тут живе все, що потребує Prisma: вибірка листів за період, дедуплікація
 * точок вигрузки і визначення зони кожної точки. Сам розрахунок — у
 * payroll.ts, який про базу нічого не знає (той самий поділ, що
 * motivation/period-facts.ts ↔ motivation/engine.ts).
 *
 * Зона точки НЕ зберігається в базі навмисно: адмін може перемкнути
 * місто/область на контрагенті заднім числом, і зарплата за минулий
 * місяць має перерахуватися сама. Збережений кеш довелося б інвалідовувати.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";
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
}

type SheetRow = {
  id: string;
  number: string;
  date: Date;
  driverId: string | null;
  driverName1C: string | null;
  driverExternalId1C: string | null;
  vehicle: string | null;
  distanceKm: number;
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
    // Адреса рядка з 1С пріоритетніша за картку клієнта: у листі вона
    // стосується саме цієї доставки, а в картці — остання відома.
    const address = stop.address?.trim() || cp?.deliveryAddress?.trim() || cp?.address?.trim() || null;

    const { zone, source } = classifyZone({
      override: cp?.deliveryZone ?? null,
      lat: cp?.deliveryLat ?? null,
      lng: cp?.deliveryLng ?? null,
      address,
    });

    const pointKey = addressKey(address, stop.counterpartyId, stop.id);
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
    };
  });
}

/** Лист → факти для калькулятора. */
export function sheetToFacts(sheet: SheetRow): RouteSheetFacts {
  const stops = resolveStops(sheet).filter((s) => s.paid);

  return {
    routeSheetId: sheet.id,
    number: sheet.number,
    day: kyivDate(sheet.date),
    distanceKm: sheet.distanceKm,
    cityPoints: stops.filter((s) => s.zone === "CITY").length,
    oblastPoints: stops.filter((s) => s.zone === "OBLAST").length,
    unknownZonePoints: stops.filter((s) => s.zoneSource === "UNKNOWN").length,
    ordersTotal: sheet.ordersTotal,
    debtsTotal: sheet.debtsTotal,
  };
}

/**
 * Маршрутні листи за період.
 *
 * Лише проведені: непроведений документ у 1С — це чернетка, за неї не
 * платять. Листи без прив'язаного водія (driverId = null) не потрапляють
 * у зарплату взагалі — їх видно окремим списком у «Налаштуваннях».
 */
export async function loadSheets(
  from: Date,
  to: Date,
  driverId?: string | null
): Promise<SheetRow[]> {
  return prisma.routeSheet.findMany({
    where: {
      date: { gte: from, lte: to },
      posted: true,
      ...(driverId ? { driverId } : {}),
    },
    orderBy: [{ date: "asc" }, { number: "asc" }],
    select: SHEET_SELECT,
  });
}

/** Факти по водію за період — вхід для calculateDriverPeriod. */
export async function buildDriverFacts(
  driverId: string,
  from: Date,
  to: Date
): Promise<RouteSheetFacts[]> {
  const sheets = await loadSheets(from, to, driverId);
  return sheets.map(sheetToFacts);
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
