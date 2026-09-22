/**
 * Ядро планування на синтетичних точках.
 *
 * База тут не потрібна навмисно: ядро — чиста функція, і саме тому його
 * поведінку можна закріпити випадками, які в реальному дні трапляються
 * раз на місяць (далеке дешеве гроно, вичерпана межа дня, закріплена точка).
 *
 *   npx tsx scripts/check-plan-day.mts
 *
 * Бази не торкається.
 */

import { planDay, clusterPoints, DEFAULT_PLAN_OPTIONS, type PlanPoint, type PlanDriver } from "../src/lib/routes/plan-day";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${String(got)}`);
  if (!ok) fails.push(name);
}

/** Склад Budvik — Львів. */
const depot = { lat: 49.84, lng: 24.03 };

function pt(id: string, lat: number, lng: number, amount: number): PlanPoint {
  return {
    id,
    counterpartyId: `cp-${id}`,
    name: id,
    lat,
    lng,
    amount,
    score: 0.3,
    pinnedDriverId: null,
  };
}

// Місто: десять точок навколо складу.
const city = Array.from({ length: 10 }, (_, i) => pt(`city${i}`, 49.84 + i * 0.004, 24.03 + i * 0.004, 4000));
// Захід, ~40 км: шість точок, добрі гроші.
const west = Array.from({ length: 6 }, (_, i) => pt(`west${i}`, 49.86 + i * 0.004, 23.52 + i * 0.004, 7000));
// Південь, ~75 км: дві точки на 4 000 ₴ разом — рейс не окупиться.
const south = [pt("south0", 49.24, 23.85, 2000), pt("south1", 49.25, 23.86, 2000)];

const points = [...city, ...west, ...south];

const drivers: PlanDriver[] = [
  { id: "d1", name: "Пайда", maxStops: 16 },
  { id: "d2", name: "Піцишин", maxStops: 13 },
];

/* ── Грона ──────────────────────────────────────────────────────────── */

const clusters = clusterPoints(points, depot, DEFAULT_PLAN_OPTIONS);
check("три грона", clusters.length === 3, clusters.map((c) => c.points.length).join("+"));
check(
  "південні точки в одному гроні",
  clusters.some((c) => c.points.length === 2 && c.points.every((p) => p.id.startsWith("south"))),
  clusters.map((c) => c.points[0].id).join(", ")
);

/* ── Відкладені ─────────────────────────────────────────────────────── */

const habits = {
  driverByClient: new Map<string, { driverId: string; count: number }[]>(),
  weekdayByClient: new Map<string, number[]>(),
  pairs: new Map<string, number>(),
};

const plain = planDay({ points, drivers, habits, depot, options: DEFAULT_PLAN_OPTIONS, weekday: 1 });
const deferredIds = plain.deferred.flatMap((d) => d.points.map((p) => p.id));
check("далеке дешеве гроно відкладено", deferredIds.includes("south0") && deferredIds.includes("south1"), deferredIds.join(", "));
check("відкладене має причину", plain.deferred.every((d) => d.reason.length > 0), plain.deferred.map((d) => d.reason).join(" | "));

const planned = plain.routes.flatMap((r) => r.points.map((p) => p.id));
check("міські й західні точки в маршрутах", planned.length === 16, planned.length);

/* ── Історія тягне точку до «свого» водія ───────────────────────────── */

const habitsWithHistory = {
  driverByClient: new Map(west.map((p) => [p.counterpartyId, [{ driverId: "d2", count: 9 }]])),
  weekdayByClient: new Map<string, number[]>(),
  pairs: new Map<string, number>(),
};

const withHistory = planDay({ points, drivers, habits: habitsWithHistory, depot, options: DEFAULT_PLAN_OPTIONS, weekday: 1 });
const westRoute = withHistory.routes.find((r) => r.points.some((p) => p.id.startsWith("west")));
check("західне гроно пішло Піцишину", westRoute?.driverId === "d2", westRoute?.driverId);
check("рішення пояснене", Boolean(westRoute?.reason), westRoute?.reason);

/* ── Межа дня ───────────────────────────────────────────────────────── */

const tight: PlanDriver[] = [
  { id: "d1", name: "Пайда", maxStops: 6 },
  { id: "d2", name: "Піцишин", maxStops: 6 },
];
const overflow = planDay({ points, drivers: tight, habits, depot, options: DEFAULT_PLAN_OPTIONS, weekday: 1 });
check(
  "жоден водій не перевищив межу",
  overflow.routes.every((r) => r.points.length <= 6),
  overflow.routes.map((r) => r.points.length).join("+")
);
check("зайве пішло у відкладені", overflow.deferred.length > 0, overflow.deferred.flatMap((d) => d.points).length);

/* ── Закріплена точка ───────────────────────────────────────────────── */

const pinned = points.map((p) => (p.id === "south0" ? { ...p, pinnedDriverId: "d1" } : p));
const withPin = planDay({ points: pinned, drivers, habits, depot, options: DEFAULT_PLAN_OPTIONS, weekday: 1 });
const pinRoute = withPin.routes.find((r) => r.points.some((p) => p.id === "south0"));
check("закріплена точка їде попри невигідність", pinRoute?.driverId === "d1", pinRoute?.driverId);

/* ── Пари не розриваються ───────────────────────────────────────────── */

const pairHabits = {
  driverByClient: new Map<string, { driverId: string; count: number }[]>(),
  weekdayByClient: new Map<string, number[]>(),
  pairs: new Map([[`cp-city0|cp-city1`, 9]]),
};
const pairPlan = planDay({ points: city, drivers: tight, habits: pairHabits, depot, options: DEFAULT_PLAN_OPTIONS, weekday: 1 });
const routeOf = (id: string) => pairPlan.routes.find((r) => r.points.some((p) => p.id === id))?.driverId ?? null;
check("стійка пара лишилась разом", routeOf("city0") === routeOf("city1"), `${routeOf("city0")} / ${routeOf("city1")}`);

if (fails.length) {
  console.error(`\nне зійшлося: ${fails.join(", ")}`);
  process.exit(1);
}
console.log("\nядро планування працює як домовлено");
