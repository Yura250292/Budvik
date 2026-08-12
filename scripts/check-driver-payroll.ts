/**
 * Перевірка розрахунку зарплати водіїв — арифметика і класифікація зон.
 *
 * Тестового раннера в проєкті немає, тож перевірка живе скриптом, як
 * check-db-health. Бази не торкається: обидва модулі, які вона перевіряє,
 * чисті. Запуск:
 *
 *   node --experimental-strip-types scripts/check-driver-payroll.ts
 *
 * Головний кейс — приклад власника: 150 км, 5 точок у місті, замовлень на
 * 40 000 при 10 000 зібраних боргів = 975 грн. Якщо ця цифра поїде,
 * поїхала зарплата.
 */

import {
  DEFAULT_RATES,
  calculateDriverPeriod,
  calculateRouteSheetPay,
  kmTier,
  type RouteSheetFacts,
} from "../src/lib/drivers/payroll.ts";
import {
  addressKey,
  classifyZone,
  looksLikeCity,
  pointInPolygon,
  LVIV_RING_POLYGON,
} from "../src/lib/drivers/zone.ts";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`          очікували: ${JSON.stringify(expected)}`);
    console.log(`          отримали:  ${JSON.stringify(actual)}`);
  }
}

const sheet = (over: Partial<RouteSheetFacts> = {}): RouteSheetFacts => ({
  routeSheetId: "rs1",
  number: "МЛ-001",
  day: "2026-08-12",
  distanceKm: 150,
  cityPoints: 5,
  oblastPoints: 0,
  ordersTotal: 40000,
  debtsTotal: 10000,
  ...over,
});

console.log("\n=== Ставка за пробіг ===");
check("99 км → 500", kmTier(99, DEFAULT_RATES).rate, 500);
check("100 км → 700 (межа в середньому тірі)", kmTier(100, DEFAULT_RATES).rate, 700);
check("150 км → 700", kmTier(150, DEFAULT_RATES).rate, 700);
check("300 км → 700 (верхня межа включно)", kmTier(300, DEFAULT_RATES).rate, 700);
check("301 км → 1000", kmTier(301, DEFAULT_RATES).rate, 1000);
check("0 км → 500", kmTier(0, DEFAULT_RATES).rate, 500);

console.log("\n=== Приклад власника: 150 км, 5 міських точок, 40000−10000 ===");
const main = calculateRouteSheetPay(sheet(), DEFAULT_RATES);
check("разом 975 грн", main.total, 975);
check("ставка 700", main.lines.find((l) => l.kind === "KM_BASE")?.amount, 700);
check("точки 125", main.lines.find((l) => l.kind === "CITY_POINTS")?.amount, 125);
check("відсоток 150", main.lines.find((l) => l.kind === "TURNOVER_PERCENT")?.amount, 150);
console.log("  пояснення рядків:");
for (const l of main.lines) console.log(`    · ${l.label}: ${l.explanation} = ${l.amount}`);

console.log("\n=== Реальний лист №1817 від 11.08.2026 (скріншот 1С) ===");
// Підсумок листа 71 966,52 включає рядок «Оплата заборгованості 000001242»
// на 5 888,00 — це старий борг, не сьогоднішня розвозка. Відсоток лише з різниці.
const real = calculateRouteSheetPay(
  sheet({
    routeSheetId: "1817",
    number: "1817",
    day: "2026-08-11",
    ordersTotal: 71966.52,
    debtsTotal: 5888,
    cityPoints: 0,
    oblastPoints: 0,
    distanceKm: 0,
  }),
  DEFAULT_RATES
);
const pctLine = real.lines.find((l) => l.kind === "TURNOVER_PERCENT");
check("база 66 078,52", pctLine?.base, 66078.52);
check("0,5% = 330,39", Math.round((pctLine?.amount ?? 0) * 100) / 100, 330.39);

console.log("\n=== Точки міста й області разом ===");
const mixed = calculateRouteSheetPay(
  sheet({ cityPoints: 3, oblastPoints: 4, ordersTotal: 0, debtsTotal: 0 }),
  DEFAULT_RATES
);
check("3×25 + 4×15 + 700 = 835", mixed.total, 835);

console.log("\n=== Борги більші за замовлення ===");
const negative = calculateRouteSheetPay(
  sheet({ ordersTotal: 5000, debtsTotal: 12000, cityPoints: 0 }),
  DEFAULT_RATES
);
check("база не від'ємна, рядка відсотка немає", negative.lines.some((l) => l.kind === "TURNOVER_PERCENT"), false);
check("лишається сама ставка 700", negative.total, 700);

console.log("\n=== Кілька листів за день: ставка за кожен ===");
const period = calculateDriverPeriod(
  "driver1",
  [
    sheet({ routeSheetId: "a", number: "МЛ-1" }),
    sheet({ routeSheetId: "b", number: "МЛ-2", distanceKm: 40, cityPoints: 2, ordersTotal: 0, debtsTotal: 0 }),
  ],
  [],
  DEFAULT_RATES
);
check("два листи", period.sheetsCount, 2);
check("975 + (500 + 50) = 1525", period.total, 1525);
check("сумарний пробіг 190", period.totalKm, 190);

console.log("\n=== Ручні надбавки ===");
const withBonus = calculateDriverPeriod(
  "driver1",
  [sheet()],
  [
    { id: "b1", day: "2026-08-12", amount: 200, reason: "Доставка Новою поштою" },
    { id: "b2", day: "2026-08-13", amount: -50, reason: "Утримання за пошкодження" },
  ],
  DEFAULT_RATES
);
check("надбавки 150", withBonus.bonusesTotal, 150);
check("разом 1125", withBonus.total, 1125);

console.log("\n=== Полігон об'їзної ===");
check("центр Львова (площа Ринок) — місто", pointInPolygon(49.8419, 24.0315, LVIV_RING_POLYGON), true);
check("Сихів — місто", pointInPolygon(49.7990, 24.0230, LVIV_RING_POLYGON), true);
check("Радехів (60 км) — не місто", pointInPolygon(50.2833, 24.6333, LVIV_RING_POLYGON), false);
check("Городок (30 км) — не місто", pointInPolygon(49.7833, 23.6500, LVIV_RING_POLYGON), false);
check("Брюховичі (за кільцем) — не місто", pointInPolygon(49.9200, 23.9600, LVIV_RING_POLYGON), false);

console.log("\n=== Класифікація зони ===");
check(
  "override перемагає координати",
  classifyZone({ override: "OBLAST", lat: 49.8419, lng: 24.0315 }),
  { zone: "OBLAST", source: "OVERRIDE" }
);
check(
  "координати в кільці → місто",
  classifyZone({ lat: 49.8419, lng: 24.0315, address: "Львівська обл., Городок" }),
  { zone: "CITY", source: "POLYGON" }
);
check(
  "без координат, адреса львівська",
  classifyZone({ address: "м. Львів, вул. Городоцька 100" }),
  { zone: "CITY", source: "ADDRESS" }
);
check(
  "без координат, адреса обласна",
  classifyZone({ address: "Львівська обл., м. Городок, вул. Львівська 5" }),
  { zone: "OBLAST", source: "ADDRESS" }
);
check(
  "нічого не відомо → область, UNKNOWN",
  classifyZone({}),
  { zone: "OBLAST", source: "UNKNOWN" }
);
check("Нова пошта у Стрию — не місто", looksLikeCity("Нова пошта №3, м. Стрий"), false);
check("Винники в кільці — місто", looksLikeCity("м. Винники, вул. Галицька 1"), true);

console.log("\n=== Дедуплікація точок ===");
const k1 = addressKey("м. Львів, вул. Городоцька, 100", "cp1", "r1");
const k2 = addressKey("м.Львів вул Городоцька 100", "cp2", "r2");
check("та сама адреса різним записом — один ключ", k1 === k2, true);
check(
  "різні адреси — різні ключі",
  addressKey("вул. Зелена 1", "cp1", "r1") === addressKey("вул. Зелена 2", "cp1", "r2"),
  false
);
check(
  "без адреси падаємо на контрагента",
  addressKey(null, "cp7", "r1") === addressKey("", "cp7", "r2"),
  true
);

console.log(`\n${failed === 0 ? "✅" : "❌"}  ${passed} пройдено, ${failed} впало\n`);
process.exit(failed === 0 ? 0 : 1);
