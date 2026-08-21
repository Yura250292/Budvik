/**
 * Перевірка нумерації точок і збереження порядку — без мережі й бази.
 *
 * Запуск: npx tsx scripts/check-route-order.ts
 *
 * Причина існування: 21.08 карта і список показували РІЗНІ маршрути.
 * Оптимізатор нумерував лише геокодовані точки, список — усі, і той самий
 * «четвертий» означав у них різних клієнтів; а точки без піна після
 * збереження ще й лишалися зі старими номерами й розліталися в середину
 * списку. Обидва правила тепер живуть в одному модулі — тут вони й
 * перевіряються.
 */

import { sequenceByRows, appendMissing } from "../src/lib/routes/order";

let failed = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

// --- Нумерація: пін займає стільки номерів, скільки рядків склеїв ---
const plain = sequenceByRows([
  { key: "a", mergedKeys: ["a"] },
  { key: "b", mergedKeys: ["b"] },
  { key: "c", mergedKeys: ["c"] },
]);
check("Без дублів номери йдуть 1,2,3", plain.map((p) => p.sequence).join() === "1,2,3", plain);

const merged = sequenceByRows([
  { key: "a", mergedKeys: ["a"] },
  // Дві накладні на ту саму адресу — один пін, два рядки в списку
  { key: "b", mergedKeys: ["b", "b2"] },
  { key: "c", mergedKeys: ["c"] },
]);
check("Пін із двох накладних забирає два номери", merged.map((p) => p.sequence).join() === "1,2,4", merged);

const noKeys = sequenceByRows([{ key: "a", mergedKeys: [] }, { key: "b", mergedKeys: ["b"] }]);
check("Точка без mergedKeys усе одно займає номер", noKeys.map((p) => p.sequence).join() === "1,2", noKeys);

// --- Збереження: перенумеровується ВЕСЬ маршрут ---
const all = ["s1", "s2", "s3", "s4", "s5"];
// s2 і s4 — без координат: в оптимізацію не потрапили
const proposed = ["s3", "s1", "s5"];
const finalOrder = appendMissing(proposed, all);
check(
  "Точки без координат ідуть у хвіст, а не лишаються в середині",
  finalOrder.join() === "s3,s1,s5,s2,s4",
  finalOrder
);
check("Жодна точка маршруту не загубилась", new Set(finalOrder).size === all.length, finalOrder);
check(
  "Порядок серед дописаних зберігається",
  finalOrder.indexOf("s2") < finalOrder.indexOf("s4"),
  finalOrder
);

check("Дубль у запропонованому порядку не подвоює точку", appendMissing(["s1", "s1", "s2"], all).join() === "s1,s2,s3,s4,s5");
check("Чужий id ігнорується", appendMissing(["s9", "s2"], all).join() === "s2,s1,s3,s4,s5");
check("Порожній порядок лишає маршрут як є", appendMissing([], all).join() === all.join());

// --- Головне: список і карта нумерують однаково ---
// Карта показує лише геокодовані точки, але бере їхні номери зі списку.
const stops = sequenceByRows([
  { key: "s3", mergedKeys: ["s3"], routed: true },
  { key: "s1", mergedKeys: ["s1"], routed: true },
  { key: "s5", mergedKeys: ["s5"], routed: true },
  { key: "s2", mergedKeys: ["s2"], routed: false },
  { key: "s4", mergedKeys: ["s4"], routed: false },
]);
const listOrder = stops.flatMap((s) => s.mergedKeys);
const pins = stops.filter((s) => s.routed).map((s) => ({ key: s.key, num: s.sequence }));
check(
  "Номер піна дорівнює номеру рядка в списку",
  pins.every((p) => listOrder.indexOf(p.key) + 1 === p.num),
  { pins, listOrder }
);
check(
  "Список збігається з тим, що збережеться",
  listOrder.join() === appendMissing(listOrder, all).join(),
  listOrder
);

console.log(failed === 0 ? "\nУсе зійшлося." : `\n${failed} перевірок не пройшло`);
process.exit(failed === 0 ? 0 : 1);
