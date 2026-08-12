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

import { CorridorIndex, corridorAxis, corridorRings } from "../src/lib/routes/corridor";
import { settlementFromAddress, normalizeSettlement, pointInRing } from "../src/lib/routes/zone";

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

console.log("\n--- Контур зони (одне кільце, а не купа фігур) ---");

// Контур може складатися з кількох кілець (гілки + дірки) — для перевірки
// ширини зливаємо всі точки в один масив.
const ring = corridorRings(axis, 10).flat();
check("Контур не порожній", ring.length > 10, { n: ring.length });

// Кожна точка контуру мусить лежати приблизно на R від осі — це і є
// означення межі. Допуск 1.5 км: на згладжених кутах і торцях точки
// відходять трохи далі, і це нормально, а от удвічі — вже вивернутий кут.
const ringDist = ring.map((p) => idx.distanceKm(p));
const minD = Math.min(...ringDist);
const maxD = Math.max(...ringDist);
check(`Усі точки контуру ≈ 10 км від осі (${minD.toFixed(1)}–${maxD.toFixed(1)})`, minD > 8.5 && maxD < 11.5, {
  minD,
  maxD,
});

// Контур мусить охоплювати вісь з ОБОХ боків: якщо одна зі сторін
// схлопнулась, зона вироджується в лінію.
const above = ring.filter((p) => p.lat > 49.5).length;
const below = ring.filter((p) => p.lat < 49.5).length;
check("Контур має точки з обох боків осі", above > 3 && below > 3, { above, below });

// Крутий поворот: вісь ламається на 90°. Тут найлегше отримати
// самоперетин або «дзьоб» на зовнішньому боці.
const corner = corridorRings(
  [
    { lat: 49.5, lng: 24.0 },
    { lat: 49.5, lng: 24.5 },
    { lat: 49.9, lng: 24.5 },
  ],
  8
).flat();
const cornerIdx = new CorridorIndex([
  { lat: 49.5, lng: 24.0 },
  { lat: 49.5, lng: 24.5 },
  { lat: 49.9, lng: 24.5 },
]);
const cornerD = corner.map((p) => cornerIdx.distanceKm(p));
check(
  `Поворот 90°: контур тримає ширину (${Math.min(...cornerD).toFixed(1)}–${Math.max(...cornerD).toFixed(1)} км)`,
  Math.min(...cornerD) > 6.5 && Math.max(...cornerD) < 9.5,
  { min: Math.min(...cornerD), max: Math.max(...cornerD) }
);

check("Вісь з однієї точки → замкнене коло", corridorRings([{ lat: 49.5, lng: 24.0 }], 5).flat().length >= 20);
check("Порожня вісь → порожній контур", corridorRings([], 5).length === 0);

// Радіус мусить масштабувати зону лінійно: подвоївши R, точки контуру
// мають відійти вдвічі далі.
const r5 = corridorRings(axis, 5).flat().map((p) => idx.distanceKm(p));
const avg5 = r5.reduce((a, b) => a + b, 0) / r5.length;
const avg10 = ringDist.reduce((a, b) => a + b, 0) / ringDist.length;
check(`Подвоєння радіуса подвоює відступ (${avg5.toFixed(1)} → ${avg10.toFixed(1)})`, near(avg10 / avg5, 2, 0.25), {
  avg5,
  avg10,
});

console.log("\n--- Ручна межа: точка в полігоні ---");

// Квадрат 2°×2° навколо (49.5, 24.0) з квадратною діркою всередині.
const outer: Array<[number, number]> = [
  [48.5, 23.0],
  [50.5, 23.0],
  [50.5, 25.0],
  [48.5, 25.0],
];
const hole: Array<[number, number]> = [
  [49.3, 23.8],
  [49.7, 23.8],
  [49.7, 24.2],
  [49.3, 24.2],
];

// Та сама логіка, що в computeZone: непарна кількість влучань = всередині.
function inRings(lat: number, lng: number, rings: Array<Array<[number, number]>>): boolean {
  let inside = false;
  for (const ring of rings) if (pointInRing(lat, lng, ring)) inside = !inside;
  return inside;
}

check("Точка всередині межі — в зоні", inRings(48.9, 23.4, [outer]));
check("Точка за межею — поза зоною", !inRings(51.5, 23.4, [outer]));
check("Точка в дірці — ПОЗА зоною", !inRings(49.5, 24.0, [outer, hole]));
check("Точка між діркою і краєм — у зоні", inRings(49.0, 24.0, [outer, hole]));
check("Порожній набір кілець нікого не втягує", !inRings(49.5, 24.0, []));

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

  // Контур на справжній геометрії: 4000+ точок із реальними вигинами
  // траси — тут вилазять артефакти, яких немає на синтетичних відрізках.
  for (const r of [5, 10, 20]) {
    const realRing = corridorRings(realAxis, r).flat();
    const d = realRing.map((p) => realIdx.distanceKm(p));
    const lo = Math.min(...d);
    const hi = Math.max(...d);
    check(
      `Контур R=${r} км тримає ширину (${lo.toFixed(1)}–${hi.toFixed(1)}), точок ${realRing.length}`,
      lo > r * 0.8 && hi < r * 1.25,
      { lo, hi, points: realRing.length }
    );
  }

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
