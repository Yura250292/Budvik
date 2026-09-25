/**
 * Перевірка автопарку наскрізь: чисті функції (ТО, амортизація), зведення
 * fleetOverview, режим shifts_report mode=fleet і види vehicles /
 * vehicle_services у query_db.
 *
 * ПИШЕ в базу пробні рядки (торговий, зміни, машина, журнал) і прибирає їх
 * у finally — тому запускається ЛИШЕ на локальній базі (127.0.0.1/localhost).
 *
 *   npx tsx --env-file=.env scripts/check-fleet.mts
 *
 * Код виходу 1, якщо хоч одна перевірка впала.
 */

import { prisma } from "../src/lib/prisma";
import { serviceDue, addMonths } from "../src/lib/fleet/due";
import { depreciation } from "../src/lib/fleet/depreciation";
import { normalizePlate } from "../src/lib/fleet/input";
import { parseVehicleLabel } from "../src/lib/fleet/label";
import { fleetOverview } from "../src/lib/fleet/overview";
import { shiftsReportTool } from "../src/lib/assistant/tools/admin";
import { runReadOnlyQuery } from "../src/lib/assistant/facts/query-db";
import { kyivDate, kyivDayStart } from "../src/lib/date/kyiv";
import type { ToolContext } from "../src/lib/assistant/types";

process.env.ASSISTANT_QUERY_DB_COUNTER = "off";

const url = process.env.DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("check-fleet пише пробні рядки — лише на локальній базі. DATABASE_URL дивиться не туди.");
  process.exit(2);
}

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

/* ── Чисті функції ─────────────────────────────────────────────────────── */

const today = "2026-09-25";
check("addMonths 31.01 + 1 = 28.02", addMonths("2026-01-31", 1) === "2026-02-28");
const lbl = parseVehicleLabel("Renault Kangoo AC 1234 BC");
check("підпис «Палива»: марка, модель, номер", lbl.make === "Renault" && lbl.model === "Kangoo" && lbl.plate === "АС1234ВС", lbl);
const lbl2 = parseVehicleLabel("Шкода Фабія");
check("підпис без номера", lbl2.make === "Шкода" && lbl2.model === "Фабія" && lbl2.plate === null, lbl2);
check("підпис порожній", parseVehicleLabel(null).make === "");
check("номер: латиниця → кирилиця", normalizePlate("bc 1234 ak") === "ВС1234АК", normalizePlate("bc 1234 ak"));

check("ТО без запису — unknown", serviceDue({ everyKm: 10000, everyMonths: 12, last: null, odometerKm: 50000, today }).state === "unknown");
const soon = serviceDue({ everyKm: 10000, everyMonths: 12, last: { day: "2026-03-01", odometerKm: 40000 }, odometerKm: 49200, today });
check("ТО за 800 км — soon", soon.state === "soon" && soon.kmLeft === 800, soon);
const overKm = serviceDue({ everyKm: 10000, everyMonths: null, last: { day: "2026-08-01", odometerKm: 40000 }, odometerKm: 50300, today });
check("ТО перебіг 300 км — overdue", overKm.state === "overdue" && overKm.kmLeft === -300, overKm);
const overDate = serviceDue({ everyKm: 10000, everyMonths: 12, last: { day: "2025-09-01", odometerKm: 40000 }, odometerKm: 41000, today });
check("ТО за датою прострочене при малому пробігу", overDate.state === "overdue", overDate);
const noKm = serviceDue({ everyKm: 10000, everyMonths: 12, last: { day: "2026-09-01", odometerKm: null }, odometerKm: 50000, today });
check("запис без пробігу — рахує лише дату", noKm.kmLeft === null && noKm.state === "ok", noKm);

check("амортизація без ціни — null", depreciation({ purchasePrice: null, purchaseDay: "2024-01-10", purchaseOdometerKm: null, usefulLifeMonths: 60, residualValue: null, odometerKm: null, today }) === null);
const dep = depreciation({ purchasePrice: 600000, purchaseDay: "2024-09-10", purchaseOdometerKm: 100000, usefulLifeMonths: 60, residualValue: 120000, odometerKm: 160000, today })!;
check("амортизація: 8000/міс, 24 міс, залишок 408000", dep.monthly === 8000 && dep.monthsElapsed === 24 && dep.bookValue === 408000, dep);
check("амортизація на км: 192000/60000 = 3.2", Math.abs((dep.perKm ?? 0) - 3.2) < 1e-9, dep.perKm);
const old = depreciation({ purchasePrice: 300000, purchaseDay: "2015-01-01", purchaseOdometerKm: null, usefulLifeMonths: 60, residualValue: 0, odometerKm: null, today })!;
check("стара машина — повністю самортизована", old.fullyDepreciated && old.bookValue === 0, old);

/* ── Наскрізь по базі ─────────────────────────────────────────────────── */

const TAG = `fleet-check-${Date.now()}`;
const created = { userId: "", vehicleId: "" };

try {
  const rep = await prisma.user.create({
    data: { email: `${TAG}@example.test`, name: "Пробний Торговий", role: "SALES" },
    select: { id: true },
  });
  created.userId = rep.id;

  const vehicle = await prisma.vehicle.create({
    data: {
      plate: normalizePlate(`zz ${Date.now() % 10000} xx`),
      make: "Renault",
      model: "Kangoo",
      year: 2019,
      odometerKm: 48000,
      odometerAt: kyivDayStart("2026-09-01"),
      purchasePrice: 600000,
      purchaseDate: kyivDayStart("2024-09-10"),
      purchaseOdometerKm: 100000,
      usefulLifeMonths: 60,
      residualValue: 120000,
    },
    select: { id: true, plate: true },
  });
  created.vehicleId = vehicle.id;

  await prisma.vehicleAssignment.create({ data: { vehicleId: vehicle.id, userId: rep.id, from: kyivDayStart("2026-09-10") } });
  // Зміна до закріплення не має ставати пробігом машини; підозріла — теж.
  const shift = (day: string, start: number, end: number, suspicious = false, personal: number | null = null) =>
    prisma.shift.create({
      data: {
        userId: rep.id,
        status: "CLOSED",
        startedAt: new Date(`${day}T06:00:00Z`),
        endedAt: new Date(`${day}T15:00:00Z`),
        startOdometer: start,
        startOdometerSource: "MANUAL",
        endOdometer: end,
        endOdometerSource: "MANUAL",
        odometerSuspicious: suspicious,
        distanceKm: suspicious ? null : end - start,
        personalKm: personal,
      },
    });
  await shift("2026-09-05", 90000, 90200);
  await shift("2026-09-22", 49000, 49250, false, 30);
  await shift("2026-09-24", 49250, 149500, true);

  await prisma.vehicleService.createMany({
    data: [
      { vehicleId: vehicle.id, date: kyivDayStart("2026-03-01"), odometerKm: 40000, kind: "OIL", title: "Масло 5W-40", partsCost: 2500, laborCost: 400 },
      { vehicleId: vehicle.id, date: kyivDayStart("2025-06-01"), odometerKm: 30000, kind: "TIMING", title: "ГРМ", partsCost: 9000, laborCost: 3000 },
    ],
  });
  await prisma.vehicleServiceRule.createMany({
    data: [
      { vehicleId: vehicle.id, kind: "OIL", title: "Масло", everyKm: 10000, everyMonths: 12 },
      { vehicleId: vehicle.id, kind: "BRAKES", title: "Гальмівна рідина", everyMonths: 24 },
    ],
  });

  const ov = await fleetOverview({ today, vehicleIds: [vehicle.id] });
  const v = ov.vehicles[0];
  check("пробіг зі зміни закріпленого, без підозрілої й старої", v?.odometer?.km === 49250 && v.odometer.source === "shift", v?.odometer);
  const oil = v?.due.find((d) => d.kind === "OIL");
  check("масло: лишилось 750 км → скоро", oil?.state === "soon" && oil.kmLeft === 750, oil);
  check("гальма без запису — немає відліку", v?.due.find((d) => d.kind === "BRAKES")?.state === "unknown");
  check("витрати з 1 січня — лише 2026 рік", v?.periodCost === 2900 && v.totalCost === 14900, { p: v?.periodCost, t: v?.totalCost });
  check("амортизація в зведенні", v?.depreciation?.bookValue === 408000, v?.depreciation);
  const sep = await fleetOverview({ today, vehicleIds: [vehicle.id], from: kyivDayStart("2026-09-01"), to: kyivDayStart("2026-09-26") });
  const km = sep.vehicles[0]?.periodKm;
  check(
    "кілометраж за вересень: лише зміни після закріплення, робочі + особисті",
    km?.workKm === 250 && km.personalKm === 30 && km.totalKm === 280 && km.drivers[0] === "Пробний Торговий",
    km
  );
  check("пальне за нормою за замовчуванням", km?.fuelLiters === 25, km);
  check("авто фірми за замовчуванням", v?.ownership === "COMPANY");

  const ctx = { today, kind: "ADMIN" } as unknown as ToolContext;
  const report = (await shiftsReportTool.run(ctx, { mode: "fleet", vehicle: vehicle.plate })) as Record<string, unknown>;
  const cars = report.машини as Array<Record<string, unknown>> | undefined;
  check("shifts_report fleet: одна машина з журналом", cars?.length === 1 && Array.isArray(report.журнал) && (report.журнал as unknown[]).length === 2, report);
  const byName = (await shiftsReportTool.run(ctx, { mode: "fleet", vehicle: "Пробний" })) as Record<string, unknown>;
  check("shifts_report fleet: пошук за прізвищем водія", (byName.машини as unknown[] | undefined)?.length === 1, byName);
  const miss = (await shiftsReportTool.run(ctx, { mode: "fleet", vehicle: "Запорожець" })) as Record<string, unknown>;
  check("shifts_report fleet: незнайдена — помилка з варіантами", typeof miss.помилка === "string", miss);

  const q1 = await runReadOnlyQuery(
    `SELECT plate, holder, odometer_km, odometer_source, service_cost_ytd, service_cost_total, depreciation_monthly, book_value FROM vehicles WHERE plate = '${vehicle.plate}' LIMIT 5`
  );
  const r1 = q1.ok ? q1.rows[0] : null;
  check(
    "вид vehicles збігається зі зведенням",
    !!r1 && Number(r1.odometer_km) === 49250 && r1.odometer_source === "shift" && Number(r1.service_cost_ytd) === 2900 &&
      Number(r1.service_cost_total) === 14900 && Number(r1.book_value) === 408000 && r1.holder === "Пробний Торговий",
    q1
  );
  const q2 = await runReadOnlyQuery(
    `SELECT day, kind, total, driver FROM vehicle_services WHERE plate = '${vehicle.plate}' ORDER BY day DESC LIMIT 5`
  );
  check("вид vehicle_services", q2.ok && q2.rows.length === 2 && q2.rows[0].kind === "OIL" && Number(q2.rows[0].total) === 2900, q2);

  console.log(`\nсьогодні за Києвом ${kyivDate(new Date())}`);
} finally {
  if (created.vehicleId) await prisma.vehicle.delete({ where: { id: created.vehicleId } }).catch(() => undefined);
  if (created.userId) {
    await prisma.shift.deleteMany({ where: { userId: created.userId } });
    await prisma.user.delete({ where: { id: created.userId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
}

console.log(failed ? `\n${failed} перевірок упало` : "\nУсе гаразд");
process.exit(failed ? 1 : 0);
