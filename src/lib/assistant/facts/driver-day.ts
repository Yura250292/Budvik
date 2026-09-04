/**
 * День водія: куди їхати, скільки точок і скільки грошей забрати.
 *
 * Джерело те саме, що в планшеті (`resolveDriverDay`), і це принципово:
 * якщо помічник почне рахувати точки власним запитом, він рано чи пізно
 * розійдеться зі списком, який водій бачить перед собою, — і повірить він
 * списку, а не помічнику.
 *
 * Борг на точці приходить із маршруту, а не з дебіторки: логіст ставить
 * саме ту суму, яку водій має привезти назад, і вона не завжди дорівнює
 * сальдо клієнта.
 */

import { resolveDriverDay } from "@/lib/track/day-stops";
import { cashForDay } from "@/lib/drivers/cash";
import { kyivDayStart } from "@/lib/date/kyiv";
import { prisma } from "@/lib/prisma";

export type DriverDayFacts = {
  day: string;
  route: {
    source: "ROUTE_SHEET" | "DELIVERY_ROUTE" | "NONE";
    number: string | null;
    vehicle: string | null;
    plannedKm: number | null;
  };
  stops: Array<{
    seq: number;
    counterpartyId: string | null;
    name: string;
    address: string | null;
    phone: string | null;
    amount: number;
    debt: number;
    kind: "DELIVERY" | "PICKUP" | "ERRAND";
    notes: string | null;
    done: boolean;
    hasPin: boolean;
  }>;
  totals: { stops: number; done: number; amount: number; debt: number };
  cash: { collected: number; handed: number; onHands: number };
};

export async function driverDayFacts(driverId: string, day: string): Promise<DriverDayFacts> {
  const [route, cash] = await Promise.all([
    resolveDriverDay(driverId, day),
    cashForDay(driverId, kyivDayStart(day)),
  ]);

  // Телефон водієві потрібен частіше за все інше: «не можу знайти в'їзд».
  const ids = route.stops.map((s) => s.counterpartyId).filter((id): id is string => Boolean(id));
  const phones = ids.length
    ? await prisma.counterparty.findMany({
        where: { id: { in: ids } },
        select: { id: true, phone: true },
      })
    : [];
  const phoneById = new Map(phones.map((p) => [p.id, p.phone]));

  const stops = route.stops.map((s) => ({
    seq: s.sequence,
    counterpartyId: s.counterpartyId,
    name: s.name,
    address: s.address,
    phone: s.counterpartyId ? (phoneById.get(s.counterpartyId) ?? null) : null,
    amount: s.amount,
    debt: s.debtAmount,
    kind: s.kind,
    notes: s.notes,
    done: s.ownVisit?.status === "DONE",
    hasPin: s.lat != null && s.lng != null,
  }));

  return {
    day: route.day ?? day,
    route: {
      source: route.source,
      number: route.number,
      vehicle: route.vehicle,
      plannedKm: route.plannedKm,
    },
    stops,
    totals: {
      stops: stops.length,
      done: stops.filter((s) => s.done).length,
      amount: stops.reduce((sum, s) => sum + s.amount, 0),
      debt: stops.reduce((sum, s) => sum + s.debt, 0),
    },
    cash: { collected: cash.collected, handed: cash.handed, onHands: cash.onHands },
  };
}
