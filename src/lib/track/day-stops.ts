/**
 * Точки на сьогодні для планшета водія.
 *
 * Джерел два, і вони не рівноцінні:
 *
 *   RouteSheet (1С) — те, що водій реально везе. Головне джерело, але
 *   з'являється лише після синхронізації і містить точки лише тоді, коли
 *   в маршрутному листі є табличні рядки (у 1С УТ 2.3 їх може не бути —
 *   точки живуть у друкованій формі).
 *
 *   DeliveryRoute (сайт) — планувальник Budvik. Працює завжди, але ним
 *   користуються не щодня.
 *
 * Беремо перше непорожнє. Порожній результат — не помилка: планшет
 * показує банер «маршрут ще не синхронізовано», а водій усе одно бачить
 * карту й може відмітити візит поза планом.
 *
 * Координати НЕ дублюються в точку маршруту: вони завжди беруться з
 * картки контрагента, щоб уточнений пін одразу відбивався на всіх
 * майбутніх маршрутах, а не лише на тих, що створені після уточнення.
 */

import { prisma } from "@/lib/prisma";
import { kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";

export type DayStop = {
  /** Стабільний ключ рядка в UI */
  key: string;
  counterpartyId: string | null;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** MANUAL — пін уточнили руками; CITY — точність лише до міста */
  geoSource: string | null;
  sequence: number;
  /** Сума документів на точці, ₴ */
  amount: number;
  /** Скільки боргу треба забрати, ₴ */
  debtAmount: number;
  routeSheetStopId: string | null;
  deliveryStopId: string | null;
};

export type DayRoute = {
  source: "ROUTE_SHEET" | "DELIVERY_ROUTE" | "NONE";
  /** Номер листа/маршруту — водій називає його диспетчеру */
  number: string | null;
  vehicle: string | null;
  /** Пробіг за планом (з 1С), км */
  plannedKm: number | null;
  stops: DayStop[];
};

const EMPTY: DayRoute = {
  source: "NONE",
  number: null,
  vehicle: null,
  plannedKm: null,
  stops: [],
};

/**
 * Кілька рядків з тією самою адресою — одна точка на карті.
 *
 * Те саме правило, що в зарплаті (payroll-facts.ts дедуплікує точки за
 * унікальною адресою), і з тієї ж причини: водій приїхав туди один раз.
 * Суми складаються, щоб він бачив, скільки всього везе на цю адресу.
 */
function mergeByAddress(stops: DayStop[]): DayStop[] {
  const byKey = new Map<string, DayStop>();

  for (const s of stops) {
    // Контрагент надійніший за адресу (та сама точка буває записана
    // по-різному), адреса — запасний ключ для рядків без контрагента.
    const dedupKey =
      s.counterpartyId ?? (s.address ? `addr:${s.address.trim().toLowerCase()}` : s.key);

    const existing = byKey.get(dedupKey);
    if (!existing) {
      byKey.set(dedupKey, { ...s });
      continue;
    }
    existing.amount += s.amount;
    existing.debtAmount += s.debtAmount;
    existing.sequence = Math.min(existing.sequence, s.sequence);
  }

  return [...byKey.values()].sort((a, b) => a.sequence - b.sequence);
}

/** Маршрутний лист 1С на цей день. */
async function fromRouteSheet(driverId: string, day: string): Promise<DayRoute | null> {
  const sheet = await prisma.routeSheet.findFirst({
    where: { driverId, date: { gte: kyivDayStart(day), lte: kyivDayEnd(day) } },
    orderBy: { number: "asc" },
    include: {
      stops: {
        orderBy: { sequence: "asc" },
        include: {
          counterparty: {
            select: {
              id: true,
              name: true,
              address: true,
              deliveryAddress: true,
              deliveryLat: true,
              deliveryLng: true,
              geoSource: true,
            },
          },
        },
      },
    },
  });

  if (!sheet || sheet.stops.length === 0) return null;

  const stops: DayStop[] = sheet.stops.map((s, i) => ({
    key: `rs:${s.id}`,
    counterpartyId: s.counterpartyId,
    name: s.counterparty?.name ?? s.address ?? "Без назви",
    address: s.address ?? s.counterparty?.deliveryAddress ?? s.counterparty?.address ?? null,
    lat: s.counterparty?.deliveryLat ?? null,
    lng: s.counterparty?.deliveryLng ?? null,
    geoSource: s.counterparty?.geoSource ?? null,
    sequence: s.sequence || i + 1,
    amount: s.amount,
    debtAmount: s.debtAmount,
    routeSheetStopId: s.id,
    deliveryStopId: null,
  }));

  return {
    source: "ROUTE_SHEET",
    number: sheet.number,
    vehicle: sheet.vehicle,
    plannedKm: sheet.distanceKm || null,
    stops: mergeByAddress(stops),
  };
}

/** Плановий маршрут сайту на цей день. */
async function fromDeliveryRoute(driverId: string, day: string): Promise<DayRoute | null> {
  const route = await prisma.deliveryRoute.findFirst({
    where: {
      driverId,
      date: { gte: kyivDayStart(day), lte: kyivDayEnd(day) },
      status: { not: "CANCELLED" },
    },
    orderBy: { createdAt: "desc" },
    include: {
      stops: {
        orderBy: { sequence: "asc" },
        include: {
          counterparty: {
            select: {
              id: true,
              name: true,
              address: true,
              deliveryAddress: true,
              deliveryLat: true,
              deliveryLng: true,
              geoSource: true,
            },
          },
          salesDocument: { select: { totalAmount: true, number: true } },
        },
      },
    },
  });

  if (!route || route.stops.length === 0) return null;

  const stops: DayStop[] = route.stops.map((s, i) => ({
    key: `ds:${s.id}`,
    counterpartyId: s.counterpartyId,
    name: s.counterparty?.name ?? s.address ?? "Без назви",
    address: s.address ?? s.counterparty?.deliveryAddress ?? s.counterparty?.address ?? null,
    lat: s.counterparty?.deliveryLat ?? null,
    lng: s.counterparty?.deliveryLng ?? null,
    geoSource: s.counterparty?.geoSource ?? null,
    sequence: s.sequence || i + 1,
    amount: s.salesDocument?.totalAmount ?? 0,
    // Планувальник сайту про борги нічого не знає — їх несе лише 1С.
    debtAmount: 0,
    routeSheetStopId: null,
    deliveryStopId: s.id,
  }));

  return {
    source: "DELIVERY_ROUTE",
    number: route.number,
    vehicle: route.vehicleInfo,
    plannedKm: route.totalDistanceKm,
    stops: mergeByAddress(stops),
  };
}

/** Точки водія на день: маршрутний лист 1С, інакше плановий маршрут сайту. */
export async function resolveDriverDay(driverId: string, day: string): Promise<DayRoute> {
  const sheet = await fromRouteSheet(driverId, day);
  if (sheet) return sheet;

  const planned = await fromDeliveryRoute(driverId, day);
  if (planned) return planned;

  return EMPTY;
}

/** Відмітка, приклеєна до точки маршруту. */
export type StopVisit = {
  status: string;
  money: string;
  collectedAmount: number | null;
  comment: string | null;
};

/**
 * Приклеює відмітки до точок за клієнтом.
 *
 * Спільне для планшета і адмінки: обидва малюють точку кольором статусу,
 * і різні реалізації давали б різні кольори на тих самих даних.
 */
export function attachVisits<V extends StopVisit & { counterpartyId: string }>(
  stops: DayStop[],
  visits: V[]
): Array<DayStop & { visit: StopVisit | null }> {
  const byClient = new Map(visits.map((v) => [v.counterpartyId, v]));
  return stops.map((s) => ({
    ...s,
    visit: s.counterpartyId ? (byClient.get(s.counterpartyId) ?? null) : null,
  }));
}
