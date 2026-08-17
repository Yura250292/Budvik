/**
 * Ефективність водіїв за період — факти для АІ-аналізу фірми.
 *
 * Зарплата вже рахується в payroll.ts; тут ті самі листи дивляться під іншим
 * кутом: скільки коштує точка вигрузки, скільки км на точку, яку частку
 * привезеного обороту з'їдає оплата водія і де цифри не сходяться.
 *
 * Джерело листів — те саме loadPayrollRows (маршрут сайту головний, лист 1С
 * запасний), тож ефективність і зарплата ніколи не розійдуться: обидві
 * дивляться на один і той самий набір виїздів.
 *
 * Дві цифри інкасації НЕ сумуються і живуть окремо навмисно:
 *   collectedVisits — відмітки водія на планшеті (Visit.collectedAmount),
 *   sheetsDebts     — база, що відняли з обороту в розрахунку зарплати.
 * Для маршрутів сайту друга виводиться з першої, тож сума була б подвійним
 * рахунком. Для листів 1С борг приходить із шапки документа, і відміток може
 * не бути взагалі. Показуємо як два свідчення, порівняння лишаємо людині.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";
import { loadPayrollRows, sheetToFacts, getRates, loadBonuses } from "./payroll-facts";
import { calculateDriverPeriod } from "./payroll";

/** Наскільки факт має перевищити план, щоб це вважалося розбіжністю. */
const KM_OVER_PLAN_FACTOR = 1.3;

export interface DriverEfficiency {
  driverId: string;
  name: string | null;

  sheets: number;
  /** Листи, за якими взагалі не відомий пробіг (kmSource = NONE) */
  sheetsWithoutKm: number;
  totalKm: number;
  /** Сума планових км лише по листах, де план є — знаменник для kmVsPlanPct */
  plannedKm: number;
  /** Факт проти плану, % (додатне — проїхав більше); null, якщо плану немає */
  kmVsPlanPct: number | null;
  kmSource: { MANUAL: number; PLAN: number; SHEET: number; NONE: number };

  cityPoints: number;
  oblastPoints: number;
  /** Оплачувані точки разом із бонусними поїздками */
  points: number;

  payrollTotal: number;
  /** Сума замовлень у листах — те, що водій привіз */
  deliveredTurnover: number;

  incasation: {
    /** Відмітки інкасації на планшеті за дні маршрутів */
    collectedVisits: number;
    /** Борги з листів — база, віднята з обороту в зарплаті */
    sheetsDebts: number;
  };

  /** ₴ зарплати на одну оплачувану точку; null, якщо точок немає */
  costPerPoint: number | null;
  kmPerPoint: number | null;
  /** Зарплата у відсотках від привезеного обороту */
  payrollToTurnoverPct: number | null;

  anomalies: {
    /** Зміни з неправдоподібною різницею одометра */
    suspiciousShifts: number;
    /** Скільки змін закрилися самі (водій забув) */
    autoClosedShifts: number;
    /** Середнє одометр/GPS; норма ~1,2–1,6 */
    avgOdometerToGpsRatio: number | null;
    /** По скількох змінах узагалі є що порівнювати */
    ratioCoverage: { withRatio: number; shifts: number };
    /** Листи, де факт перевищив план більш ніж у 1,3 раза */
    kmOverPlan: number;
  };
}

export interface DriverEfficiencyReport {
  drivers: DriverEfficiency[];
  /** Листи без прив'язаного водія — зарплати не творять, але робота була */
  unassignedSheets: number;
  /** Медіани по команді: модель порівнює з готовою цифрою, а не рахує сама */
  medians: {
    costPerPoint: number | null;
    kmPerPoint: number | null;
    payrollToTurnoverPct: number | null;
  };
}

function median(values: number[]): number | null {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (list.length === 0) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 === 1 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
}

const round = (n: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/**
 * Ефективність усіх водіїв за період.
 *
 * Один прохід по листах на всю команду: розбивати на запит-на-водія немає
 * сенсу, вибірка й так іде за датою.
 */
export async function driverEfficiencyFacts(
  from: Date,
  to: Date
): Promise<DriverEfficiencyReport> {
  const [rows, rates, bonuses] = await Promise.all([
    loadPayrollRows(from, to),
    getRates(),
    loadBonuses(from, to),
  ]);

  const assigned = rows.filter((r) => r.driverId);
  const unassignedSheets = rows.length - assigned.length;

  const byDriver = new Map<string, typeof assigned>();
  for (const row of assigned) {
    const id = row.driverId as string;
    byDriver.set(id, [...(byDriver.get(id) ?? []), row]);
  }

  const driverIds = [...byDriver.keys()];
  if (driverIds.length === 0) {
    return {
      drivers: [],
      unassignedSheets,
      medians: { costPerPoint: null, kmPerPoint: null, payrollToTurnoverPct: null },
    };
  }

  // Зміни й відмітки — по днях маршрутів, а не по всьому періоду: водій міг
  // відкрити зміну в день без жодного листа, і вона не стосується цих виїздів.
  const [shifts, visits] = await Promise.all([
    prisma.shift.findMany({
      where: { userId: { in: driverIds }, startedAt: { gte: from, lte: to } },
      select: {
        userId: true,
        odometerSuspicious: true,
        odometerToGpsRatio: true,
        closedAutomatically: true,
      },
    }),
    prisma.visit.findMany({
      where: {
        userId: { in: driverIds },
        day: { gte: from, lte: to },
        collectedAmount: { gt: 0 },
      },
      select: { userId: true, day: true, collectedAmount: true },
    }),
  ]);

  const drivers: DriverEfficiency[] = driverIds.map((driverId) => {
    const sheetRows = byDriver.get(driverId) ?? [];
    const facts = sheetRows.map(sheetToFacts);
    const payroll = calculateDriverPeriod(
      driverId,
      facts,
      bonuses.filter((b) => b.driverId === driverId),
      rates
    );

    const kmSource = { MANUAL: 0, PLAN: 0, SHEET: 0, NONE: 0 };
    for (const f of facts) kmSource[f.kmSource ?? "NONE"] += 1;

    // План рахуємо лише там, де він є: інакше знаменник змішував би листи
    // 1С (плану не мають узагалі) з маршрутами сайту.
    const withPlan = sheetRows.filter((r) => r.plannedKm != null && r.plannedKm > 0);
    const plannedKm = withPlan.reduce((s, r) => s + (r.plannedKm ?? 0), 0);
    const factKmWithPlan = withPlan.reduce((s, r) => s + r.distanceKm, 0);
    const kmOverPlan = withPlan.filter(
      (r) => r.distanceKm > (r.plannedKm ?? 0) * KM_OVER_PLAN_FACTOR
    ).length;

    const extraPoints = facts.reduce((s, f) => s + (f.paidExtras?.length ?? 0), 0);
    const points = payroll.cityPoints + payroll.oblastPoints + extraPoints;
    const deliveredTurnover = facts.reduce((s, f) => s + f.ordersTotal, 0);
    const sheetsDebts = facts.reduce((s, f) => s + f.debtsTotal, 0);

    const routeDays = new Set(sheetRows.map((r) => kyivDate(r.date)));
    const collectedVisits = visits
      .filter((v) => v.userId === driverId && routeDays.has(kyivDate(v.day)))
      .reduce((s, v) => s + (v.collectedAmount ?? 0), 0);

    const myShifts = shifts.filter((s) => s.userId === driverId);
    const ratios = myShifts
      .map((s) => s.odometerToGpsRatio)
      .filter((r): r is number => r != null && Number.isFinite(r));

    return {
      driverId,
      name: sheetRows[0]?.driverName ?? null,
      sheets: facts.length,
      sheetsWithoutKm: kmSource.NONE,
      totalKm: round(payroll.totalKm, 1),
      plannedKm: round(plannedKm, 1),
      kmVsPlanPct:
        plannedKm > 0 ? round(((factKmWithPlan - plannedKm) / plannedKm) * 100, 1) : null,
      kmSource,
      cityPoints: payroll.cityPoints,
      oblastPoints: payroll.oblastPoints,
      points,
      payrollTotal: round(payroll.total),
      deliveredTurnover: round(deliveredTurnover),
      incasation: {
        collectedVisits: round(collectedVisits),
        sheetsDebts: round(sheetsDebts),
      },
      costPerPoint: points > 0 ? round(payroll.total / points) : null,
      kmPerPoint: points > 0 ? round(payroll.totalKm / points, 1) : null,
      payrollToTurnoverPct:
        deliveredTurnover > 0 ? round((payroll.total / deliveredTurnover) * 100, 2) : null,
      anomalies: {
        suspiciousShifts: myShifts.filter((s) => s.odometerSuspicious).length,
        autoClosedShifts: myShifts.filter((s) => s.closedAutomatically).length,
        avgOdometerToGpsRatio:
          ratios.length > 0
            ? round(ratios.reduce((s, r) => s + r, 0) / ratios.length, 2)
            : null,
        ratioCoverage: { withRatio: ratios.length, shifts: myShifts.length },
        kmOverPlan,
      },
    };
  });

  drivers.sort((a, b) => b.payrollTotal - a.payrollTotal);

  return {
    drivers,
    unassignedSheets,
    medians: {
      costPerPoint: median(
        drivers.map((d) => d.costPerPoint).filter((v): v is number => v != null)
      ),
      kmPerPoint: median(
        drivers.map((d) => d.kmPerPoint).filter((v): v is number => v != null)
      ),
      payrollToTurnoverPct: median(
        drivers.map((d) => d.payrollToTurnoverPct).filter((v): v is number => v != null)
      ),
    },
  };
}
