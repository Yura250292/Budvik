/**
 * Автопарк одним зведенням: пробіг, ТО, витрати, амортизація.
 *
 * Одне джерело для адмінки, помічника керівника, MCP і ранкового зведення —
 * щоб «скільки лишилось до заміни масла» ніде не рахувалося по-своєму.
 * Без жодного імпорту з next/*: зведення бере й воркер.
 *
 * Поточний пробіг — найсвіжіше (за датою, не за числом) з трьох джерел:
 *   • ручне показання в картці машини;
 *   • пробіг у записі журналу обслуговування;
 *   • одометр зі зміни людини, закріпленої за машиною саме того дня
 *     (VehicleAssignment). Зміни з міткою «неправдоподібний одометр»
 *     пропускаємо: AI-помилка на 100 000 км зробила б усе ТО «простроченим».
 * Беремо найсвіжіше, а не найбільше: так виправлене руками показання
 * перекриває старе хибне.
 */

import type { VehicleOwnership, VehicleServiceKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { VEHICLE_DEFAULTS } from "@/lib/analytics/facts";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { DUE_RANK, serviceDue, type Due } from "./due";
import { depreciation, type Depreciation } from "./depreciation";
import { KIND_LABEL } from "./kinds";

export type OdometerSource = "manual" | "service" | "shift";

export type Odometer = {
  km: number;
  day: string;
  source: OdometerSource;
  /** Чия зміна дала показання — лише для source="shift" */
  by: string | null;
};

export type FleetRuleDue = Due & {
  kind: VehicleServiceKind;
  kindLabel: string;
  title: string;
  everyKm: number | null;
  everyMonths: number | null;
  lastDay: string | null;
  lastOdometerKm: number | null;
};

/**
 * Кілометраж машини за період — тими самими правилами, що «Паливо»:
 * зміни, ВІДКРИТІ в періоді, тих, хто був закріплений за машиною того дня.
 * Робочі — одометр усередині змін, особисті — між змінами (дорога додому).
 * Пальне — робочі км × норма людини з «Палива» (як там же).
 */
export type PeriodKm = {
  workKm: number;
  personalKm: number;
  totalKm: number;
  shifts: number;
  /** Зміни без одометра ще відкриті — їхні км дорахуються після закриття */
  openShifts: number;
  fuelLiters: number;
  fuelCost: number;
  drivers: string[];
};

export type FleetVehicle = {
  id: string;
  plate: string | null;
  ownership: VehicleOwnership;
  make: string;
  model: string;
  year: number | null;
  vin: string | null;
  fuelType: string | null;
  active: boolean;
  notes: string | null;
  holder: { userId: string; name: string; since: string } | null;
  odometer: Odometer | null;
  due: FleetRuleDue[];
  /** Найгірший стан серед правил — для бейджа в списку */
  worstDue: FleetRuleDue | null;
  /** Витрати на обслуговування за період */
  periodCost: number;
  periodKm: PeriodKm;
  periodServices: number;
  /** За весь час */
  totalCost: number;
  lastService: { day: string; kindLabel: string; title: string } | null;
  depreciation: Depreciation | null;
  purchase: {
    price: number | null;
    day: string | null;
    odometerKm: number | null;
    usefulLifeMonths: number | null;
    residualValue: number | null;
  };
  manualOdometer: { km: number | null; day: string | null };
};

export type FleetOverview = {
  today: string;
  period: { from: string; to: string } | null;
  vehicles: FleetVehicle[];
  totals: {
    vehicles: number;
    overdue: number;
    soon: number;
    periodCost: number;
    monthlyDepreciation: number;
    periodKm: number;
    fuelCost: number;
  };
};

type Options = {
  today?: string;
  /** Межі періоду для periodCost (включно); без них — поточний календарний рік */
  from?: Date;
  to?: Date;
  vehicleIds?: string[];
  includeInactive?: boolean;
};

/** Останнє показання зі змін закріплених людей — одним запитом на всі машини. */
async function shiftOdometers(vehicleIds: string[]): Promise<Map<string, Odometer>> {
  if (vehicleIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ vehicleId: string; km: number; at: Date; name: string }>>`
    SELECT DISTINCT ON (a."vehicleId")
           a."vehicleId", r.km, r.at, u.name
    FROM "VehicleAssignment" a
    JOIN "User" u ON u.id = a."userId"
    JOIN LATERAL (
      SELECT COALESCE(s."endOdometer", s."startOdometer") AS km,
             COALESCE(s."endedAt", s."startedAt") AS at
      FROM "Shift" s
      WHERE s."userId" = a."userId"
        AND s."odometerSuspicious" = false
        AND COALESCE(s."endedAt", s."startedAt") >= a."from"
        AND (a."to" IS NULL OR COALESCE(s."endedAt", s."startedAt") <= a."to")
      ORDER BY COALESCE(s."endedAt", s."startedAt") DESC
      LIMIT 1
    ) r ON TRUE
    WHERE a."vehicleId" = ANY(${vehicleIds})
    ORDER BY a."vehicleId", r.at DESC`;
  return new Map(
    rows.map((r) => [r.vehicleId, { km: Number(r.km), day: kyivDate(r.at), source: "shift", by: r.name }])
  );
}

const NO_KM: PeriodKm = { workKm: 0, personalKm: 0, totalKm: 0, shifts: 0, openShifts: 0, fuelLiters: 0, fuelCost: 0, drivers: [] };

async function periodKmByVehicle(vehicleIds: string[], from: Date, to: Date): Promise<Map<string, PeriodKm>> {
  if (vehicleIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<
    Array<{ vehicleId: string; work: number; personal: number; shifts: number; open: number; liters: number; cost: number; drivers: string[] }>
  >`
    SELECT a."vehicleId",
           COALESCE(SUM(s."distanceKm"), 0)::float AS work,
           COALESCE(SUM(s."personalKm"), 0)::float AS personal,
           COUNT(*) FILTER (WHERE s."distanceKm" IS NOT NULL)::int AS shifts,
           COUNT(*) FILTER (WHERE s.status = 'OPEN')::int AS open,
           COALESCE(SUM(s."distanceKm" / 100.0 * COALESCE(sv."fuelConsumption", ${VEHICLE_DEFAULTS.fuelConsumption})), 0)::float AS liters,
           COALESCE(SUM(s."distanceKm" / 100.0 * COALESCE(sv."fuelConsumption", ${VEHICLE_DEFAULTS.fuelConsumption})
                        * COALESCE(sv."fuelPricePerL", ${VEHICLE_DEFAULTS.fuelPricePerL})), 0)::float AS cost,
           array_agg(DISTINCT u.name) AS drivers
    FROM "VehicleAssignment" a
    JOIN "Shift" s ON s."userId" = a."userId"
      AND s."startedAt" >= a."from" AND (a."to" IS NULL OR s."startedAt" < a."to")
    JOIN "User" u ON u.id = a."userId"
    LEFT JOIN "SalesVehicle" sv ON sv."repId" = s."userId"
    WHERE a."vehicleId" = ANY(${vehicleIds})
      AND s."startedAt" >= ${from} AND s."startedAt" <= ${to}
    GROUP BY a."vehicleId"`;
  return new Map(
    rows.map((r) => [
      r.vehicleId,
      {
        workKm: Math.round(r.work),
        personalKm: Math.round(r.personal),
        totalKm: Math.round(r.work + r.personal),
        shifts: r.shifts,
        openShifts: r.open,
        fuelLiters: Math.round(r.liters),
        fuelCost: Math.round(r.cost),
        drivers: r.drivers.filter(Boolean),
      },
    ])
  );
}

function latest(candidates: Array<Odometer | null>): Odometer | null {
  let best: Odometer | null = null;
  for (const c of candidates) {
    if (!c) continue;
    if (!best || c.day > best.day || (c.day === best.day && c.km > best.km)) best = c;
  }
  return best;
}

export async function fleetOverview(opts: Options = {}): Promise<FleetOverview> {
  const today = opts.today ?? kyivDate(new Date());
  const yearStart = kyivDayStart(`${today.slice(0, 4)}-01-01`);
  const from = opts.from ?? yearStart;
  const to = opts.to ?? new Date();

  const vehicles = await prisma.vehicle.findMany({
    where: {
      ...(opts.includeInactive ? {} : { active: true }),
      ...(opts.vehicleIds ? { id: { in: opts.vehicleIds } } : {}),
    },
    include: {
      assignments: {
        where: { to: null },
        include: { user: { select: { id: true, name: true } } },
        orderBy: { from: "desc" },
        take: 1,
      },
      rules: true,
      services: {
        select: { date: true, odometerKm: true, kind: true, title: true, partsCost: true, laborCost: true },
        orderBy: { date: "desc" },
      },
    },
    orderBy: [{ active: "desc" }, { plate: "asc" }],
  });

  const ids = vehicles.map((v) => v.id);
  const [fromShifts, kmOf] = await Promise.all([shiftOdometers(ids), periodKmByVehicle(ids, from, to)]);

  const out: FleetVehicle[] = vehicles.map((v) => {
    const manual: Odometer | null =
      v.odometerKm != null && v.odometerAt
        ? { km: v.odometerKm, day: kyivDate(v.odometerAt), source: "manual", by: null }
        : null;
    const lastWithKm = v.services.find((s) => s.odometerKm != null);
    const fromService: Odometer | null = lastWithKm
      ? { km: lastWithKm.odometerKm!, day: kyivDate(lastWithKm.date), source: "service", by: null }
      : null;
    const odometer = latest([manual, fromService, fromShifts.get(v.id) ?? null]);

    const due: FleetRuleDue[] = v.rules
      .map((rule) => {
        // Останній запис цього виду; пробіг беремо з найсвіжішого, де він є.
        const ofKind = v.services.filter((s) => s.kind === rule.kind);
        const last = ofKind[0] ?? null;
        const lastKm = last?.odometerKm ?? null;
        const d = serviceDue({
          everyKm: rule.everyKm,
          everyMonths: rule.everyMonths,
          last: last ? { day: kyivDate(last.date), odometerKm: lastKm } : null,
          odometerKm: odometer?.km ?? null,
          today,
        });
        return {
          ...d,
          kind: rule.kind,
          kindLabel: KIND_LABEL[rule.kind],
          title: rule.title,
          everyKm: rule.everyKm,
          everyMonths: rule.everyMonths,
          lastDay: last ? kyivDate(last.date) : null,
          lastOdometerKm: lastKm,
        };
      })
      .sort((a, b) => DUE_RANK[a.state] - DUE_RANK[b.state] || (a.kmLeft ?? 1e9) - (b.kmLeft ?? 1e9));

    const inPeriod = v.services.filter((s) => s.date >= from && s.date <= to);
    const cost = (s: { partsCost: number; laborCost: number }) => s.partsCost + s.laborCost;
    const holder = v.assignments[0];

    return {
      id: v.id,
      plate: v.plate,
      ownership: v.ownership,
      make: v.make,
      model: v.model,
      year: v.year,
      vin: v.vin,
      fuelType: v.fuelType,
      active: v.active,
      notes: v.notes,
      holder: holder ? { userId: holder.user.id, name: holder.user.name, since: kyivDate(holder.from) } : null,
      odometer,
      due,
      worstDue: due.find((d) => d.state === "overdue" || d.state === "soon") ?? null,
      periodCost: inPeriod.reduce((sum, s) => sum + cost(s), 0),
      periodKm: kmOf.get(v.id) ?? NO_KM,
      periodServices: inPeriod.length,
      totalCost: v.services.reduce((sum, s) => sum + cost(s), 0),
      lastService: v.services[0]
        ? { day: kyivDate(v.services[0].date), kindLabel: KIND_LABEL[v.services[0].kind], title: v.services[0].title }
        : null,
      depreciation: depreciation({
        purchasePrice: v.purchasePrice,
        purchaseDay: v.purchaseDate ? kyivDate(v.purchaseDate) : null,
        purchaseOdometerKm: v.purchaseOdometerKm,
        usefulLifeMonths: v.usefulLifeMonths,
        residualValue: v.residualValue,
        odometerKm: odometer?.km ?? null,
        today,
      }),
      purchase: {
        price: v.purchasePrice,
        day: v.purchaseDate ? kyivDate(v.purchaseDate) : null,
        odometerKm: v.purchaseOdometerKm,
        usefulLifeMonths: v.usefulLifeMonths,
        residualValue: v.residualValue,
      },
      manualOdometer: { km: v.odometerKm, day: v.odometerAt ? kyivDate(v.odometerAt) : null },
    };
  });

  const active = out.filter((v) => v.active);
  return {
    today,
    period: { from: kyivDate(from), to: kyivDate(to) },
    vehicles: out,
    totals: {
      vehicles: active.length,
      overdue: active.filter((v) => v.due.some((d) => d.state === "overdue")).length,
      soon: active.filter((v) => !v.due.some((d) => d.state === "overdue") && v.due.some((d) => d.state === "soon")).length,
      periodCost: out.reduce((s, v) => s + v.periodCost, 0),
      monthlyDepreciation: active.reduce(
        (s, v) => s + (v.depreciation && !v.depreciation.fullyDepreciated ? v.depreciation.monthly : 0),
        0
      ),
      periodKm: out.reduce((s, v) => s + v.periodKm.totalKm, 0),
      fuelCost: out.reduce((s, v) => s + v.periodKm.fuelCost, 0),
    },
  };
}
