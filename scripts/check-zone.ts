/**
 * Перевірка зони напрямку: геометрія коридору і розбір адрес.
 *
 * Запуск: npx tsx scripts/check-zone.ts
 *
 * Дві речі, які тихо ламають зону і яких не видно на карті:
 * 1) відстань до відрізка — якщо міряти лише до вершин геометрії, клієнт
 *    посеред прямої ділянки траси «відлітає» від маршруту на кілометри;
 * 2) розбір адреси — з нього будуються білі плями, і якщо він назве
 *    вулицю населеним пунктом, з'являться плями-привиди.
 *
 * Друга частина скрипта ходить у базу і рахує зону реального напрямку —
 * там перевіряється, що пункти маршруту лежать на власній осі.
 */

import { CorridorIndex, corridorAxis } from "../src/lib/routes/corridor";
import { settlementFromAddress, normalizeSettlement } from "../src/lib/routes/zone";

let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

console.log("--- Геометрія коридору ---");

// Відрізок уздовж паралелі 49.5°: 1° довготи ≈ 72.3 км.
const axis = [
  { lat: 49.5, lng: 24.0 },
  { lat: 49.5, lng: 25.0 },
];
const idx = new CorridorIndex(axis);

check("Точка на осі — нуль", near(idx.distanceKm({ lat: 49.5, lng: 24.5 }), 0, 0.01));

// Головний випадок: точка навпроти СЕРЕДИНИ відрізка. Якщо міряти до
// вершин, вийде ~36 км замість 11.
const mid = idx.distanceKm({ lat: 49.6, lng: 24.5 });
check("Збоку від середини відрізка ≈ 11.1 км (а не до вершин)", near(mid, 11.13, 0.1), mid);

// За торцем відрізка відстань міряється до його кінця, а не до продовження прямої.
const beyond = idx.distanceKm({ lat: 49.5, lng: 25.5 });
check("За торцем ≈ 36.2 км до кінця відрізка", near(beyond, 36.15, 0.3), beyond);

const single = new CorridorIndex([{ lat: 49.5, lng: 24.0 }]);
check("Одна точка осі не ламає розрахунок", near(single.distanceKm({ lat: 49.5, lng: 24.0 }), 0, 0.01));

const empty = new CorridorIndex([]);
check("Порожня вісь → нескінченність (нікого не втягує в зону)", empty.distanceKm({ lat: 49.5, lng: 24.0 }) === Infinity);

check(
  "Без геометрії OSRM вісь падає на пункти маршруту",
  corridorAxis(null, [{ lat: 49.5, lng: 24.0 }]).length === 1
);
check(
  "Геометрія OSRM читається як [lng, lat]",
  (() => {
    const a = corridorAxis({ coordinates: [[24.0, 49.5]] }, []);
    return a[0].lat === 49.5 && a[0].lng === 24.0;
  })()
);

console.log("\n--- Розбір адреси (з нього ростуть білі плями) ---");

const addressCases: Array<[string | null, string | null]> = [
  ["м.Львів, вул.Шевченка,154", "м.Львів"],
  ["Львівська обл., Жидачів", "Жидачів"],
  ["м. Львів-Винники, вул.Галицька 109 а", "м. Львів-Винники"],
  ["Малехів", "Малехів"],
  ["вул.Січових Стрільців, 12", null],
  ["", null],
  [null, null],
];
for (const [input, expected] of addressCases) {
  const got = settlementFromAddress(input);
  check(`«${input ?? "null"}» → ${expected ?? "null"}`, got === expected, { got });
}

check(
  "«м. Стрий» і «Стрий» — один пункт",
  normalizeSettlement("м. Стрий") === normalizeSettlement("Стрий")
);
check(
  "«с.Сокільники» і «Сокільники» — один пункт",
  normalizeSettlement("с.Сокільники") === normalizeSettlement("Сокільники")
);

// --- Реальні дані ---
async function realData() {
  const { prisma } = await import("../src/lib/prisma");

  const template = await prisma.routeTemplate.findFirst({
    where: { isActive: true },
    include: { stops: { orderBy: { seq: "asc" } } },
  });

  if (!template) {
    console.log("\n(напрямків у базі немає — перевірку на реальних даних пропущено)");
    return;
  }

  console.log(`\n--- Реальний напрямок «${template.name}» ---`);

  const realAxis = corridorAxis(
    template.routeGeometry as { coordinates?: [number, number][] } | null,
    template.stops.map((s) => ({ lat: s.lat, lng: s.lng }))
  );
  const realIdx = new CorridorIndex(realAxis);
  console.log(`  точок осі: ${realAxis.length}`);

  // Сам маршрут мусить лежати на своїй осі. Допуск 0.5 км — це похибка
  // геокодера пунктів, а не проєкції: Nominatim ставить пін у центр міста,
  // а OSRM веде дорогу повз нього.
  let maxOff = 0;
  for (const s of template.stops) {
    maxOff = Math.max(maxOff, realIdx.distanceKm({ lat: s.lat, lng: s.lng }));
  }
  check(`Усі пункти маршруту лежать на осі (макс. ${maxOff.toFixed(2)} км)`, maxOff < 0.5, { maxOff });

  const cps = await prisma.counterparty.findMany({
    where: { deliveryLat: { not: null }, deliveryLng: { not: null }, isActive: true },
    select: { deliveryLat: true, deliveryLng: true, address: true },
  });

  const counts = [5, 10, 15, 25].map((r) => ({
    r,
    n: cps.filter(
      (c) => realIdx.distanceKm({ lat: c.deliveryLat!, lng: c.deliveryLng! }) <= r
    ).length,
  }));
  console.log(`  у зоні: ${counts.map((c) => `${c.r} км → ${c.n}`).join(", ")} (усього ${cps.length})`);

  check(
    "Зона монотонно росте з радіусом",
    counts.every((c, i) => i === 0 || c.n >= counts[i - 1].n),
    counts
  );

  const parsed = cps.filter((c) => settlementFromAddress(c.address) !== null).length;
  const share = Math.round((parsed / Math.max(1, cps.length)) * 100);
  console.log(`  адрес, з яких вдалося витягнути НП: ${parsed}/${cps.length} (${share}%)`);
  check("З більшості адрес НП визначається", share >= 60, { share });

  await prisma.$disconnect();
}

// .then(), а не top-level await: tsx збирає скрипти в CJS, де його немає.
realData()
  .catch((e) => {
    failed++;
    console.log(`✗ Перевірка на реальних даних впала: ${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(() => {
    console.log(failed === 0 ? "\nУсі перевірки пройдено" : `\nПровалено: ${failed}`);
    process.exit(failed === 0 ? 0 : 1);
  });
