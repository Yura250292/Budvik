/**
 * Пошук прощає правопис: апостроф, мʼякий знак, латинську «i», дужки.
 *
 *   npx tsx --env-file=.env scripts/check-search-spelling.mts
 *
 * Навіщо. 23.09.2026 «Яцків не знайдено» (у базі «Яцьків») потягнуло аудит
 * усіх пошуків, і та сама хвороба знайшлася ще в пʼяти місцях:
 *
 *   - редактор маршрутів в адмінці: «Яцків», «Близняк Мар'ян» (у базі
 *     «Мар`ян»), «у Перемишлянах» — порожній список;
 *   - клієнти в місті: «м. Перемишляни» — 9 із 25, «(Перемишляни)» — 1;
 *   - товари в помічнику: «зʼєднувальна» з клавіатури телефона чи
 *     «мясорубка» без апострофа — нуль;
 *   - вітрина: 670 назв пишуть латинську «i» («полiр», «вiдрiзний»), а
 *     телефонний «ʼ» Unicode вважає буквою — «руківʼям» не знаходилось;
 *   - співробітники: «Пицишин» замість «Піцишин» — нікого.
 *
 * Друга половина — те, що вже працювало, і мусить працювати далі.
 * Лише читання бази; імена — живі, тож перейменування в 1С тут видно.
 */

import { searchProducts } from "../src/lib/assistant/facts/product-facts";
import { clientProductPurchases } from "../src/lib/assistant/facts/client-purchases";
import { clientsInCity } from "../src/lib/assistant/facts/city-clients";
import { resolveStaff } from "../src/lib/assistant/facts/staff";
import { counterpartyIdsByWords } from "../src/lib/search/client-words";
import { suggestProducts } from "../src/lib/catalog/suggest";
import { fetchCatalogPage, parseFilters } from "../src/lib/catalog/query";
import { prisma } from "../src/lib/prisma";

const fails: string[] = [];
function check(name: string, ok: boolean, got: unknown) {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} — ${typeof got === "string" ? got : JSON.stringify(got)}`);
  if (!ok) fails.push(name);
}

const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
if (!admin) {
  console.log("FAIL у базі немає ADMIN");
  process.exit(1);
}

/* ── Редактор маршрутів (адмінка) ────────────────────────────────── */

const names = async (q: string) => {
  const ids = await counterpartyIdsByWords(q, 50);
  const rows = await prisma.counterparty.findMany({ where: { id: { in: ids } }, select: { name: true } });
  return rows.map((r) => r.name);
};
for (const [q, want] of [
  ["Яцків Перемишляни", /^Яцьків Іван Теодорович/],
  ["Близняк Мар'ян", /Близняк Мар`ян/],
  ["Близняк Марʼян", /Близняк Мар`ян/],
  ["Скалоцька Перемишлянах", /Скалоцька.*Перемишлян/],
  ["Коваль смт Жовтанці", /Коваль Андрій/],
  ["Химич Рава-Руська", /Химич/],
  ["Кунанцем", /Кунанець/],
] as const) {
  const got = await names(q);
  check(`адмінка «${q}»`, got.some((n) => want.test(n)), `${got.length}: ${got.slice(0, 2).join(" | ")}`);
}

/* ── Клієнти в місті (помічник) ──────────────────────────────────── */

const base = (await clientsInCity("Перемишляни", admin.id, 40)).clients.length;
check("місто: «Перемишляни» знаходить десятки", base >= 20, base);
for (const q of ["м. Перемишляни", "(Перемишляни)", "Перемишлянах", "перемишляни,"]) {
  const n = (await clientsInCity(q, admin.id, 40)).clients.length;
  check(`місто: «${q}» — стільки ж`, n === base, `${n} проти ${base}`);
}
const rava = (await clientsInCity("Рава-Руська", admin.id, 40)).clients.length;
check("місто з мʼяким знаком: «Рава-Руська»", rava > 0, rava);

/* ── Товари в помічнику ──────────────────────────────────────────── */

const RUKIV = /Довгогубці.*руків.ям/i;
for (const q of ["довгогубці руків'ям", "довгогубці руківʼям", "довгогубці руківям"]) {
  const hits = await searchProducts(q, admin.id, 8);
  check(`помічник «${q}»`, hits.some((h) => RUKIV.test(h.name)), `${hits.length}: ${hits[0]?.name ?? "—"}`);
}
for (const [q, want] of [
  ["круг відрізний 125", /Круг в[iі]др[iі]зний/i],
  ["сома фікс", /SOMA FIX/i],
  ["дріт для зварювання", /Дріт зварювальний/i],
  ["піни", /Піна/i],
] as const) {
  const hits = await searchProducts(q, admin.id, 8);
  check(`помічник як і раніше «${q}»`, hits.some((h) => want.test(h.name)), `${hits.length}: ${hits[0]?.name ?? "—"}`);
}

// Закупівлі клієнта: беремо живу пару «клієнт — товар з апострофом».
const [pair] = await prisma.$queryRaw<Array<{ cp: string; name: string }>>`
  SELECT s."counterpartyId" AS cp, p.name
  FROM "SalesDocumentItem" i
  JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
  JOIN "Product" p ON p.id = i."productId"
  WHERE s."counterpartyId" IS NOT NULL AND s."docType" = 'REALIZATION'
    AND p.name ~ '[а-яіїє][''’\`][єїюя]'
  ORDER BY s."createdAt" DESC LIMIT 1`;
if (pair) {
  const word = (pair.name.match(/[А-Яа-яІіЇїЄєҐґ]+['’`][єїюяЄЇЮЯ][А-Яа-яІіЇїЄєҐґ]*/) ?? [""])[0];
  const typed = word.replace(/['’`]/, "");
  const r = await clientProductPurchases(pair.cp, typed, 12);
  const found = JSON.stringify(r).includes(pair.name.slice(0, 20).replace(/"/g, '\\"'));
  check(`закупівлі клієнта: «${typed}» без апострофа → «${word}»`, found, pair.name);
} else {
  console.log("skip закупівлі клієнта: у продажах немає товару з апострофом");
}

/* ── Вітрина: каталог і підказки ─────────────────────────────────── */

const catalog = async (q: string) =>
  ((await fetchCatalogPage(parseFilters({ search: q }), 1)) as { products: Array<{ name: string }> }).products;

for (const [q, want] of [
  ["ключ рожково-накидний полір", /пол[iі]р/i],
  ["довгогубці руківʼям", /руків.ям/i],
] as const) {
  const cat = await catalog(q);
  check(`каталог «${q}»`, cat.some((h) => want.test(h.name)), `${cat.length}: ${cat.find((h) => want.test(h.name))?.name ?? cat[0]?.name ?? "—"}`);
  const sug = await suggestProducts(q);
  check(`підказки «${q}»`, sug.some((h) => want.test(h.name)), `${sug.length}: ${sug.find((h) => want.test(h.name))?.name ?? sug[0]?.name ?? "—"}`);
}
for (const [q, want] of [
  ["валики", /Валик/i],
  ["дриль", /Дриль/i],
  ["круг відрізний 125", /Круг в[iі]др[iі]зний/i],
] as const) {
  const cat = await catalog(q);
  check(`каталог як і раніше «${q}»`, cat.some((h) => want.test(h.name)), `${cat.length}: ${cat[0]?.name ?? "—"}`);
}

/* ── Співробітники ───────────────────────────────────────────────── */

const ALL = ["DRIVER", "SALES", "WAREHOUSE", "ADMIN"] as never;
for (const [q, want] of [
  ["Пицишин", "Піцишин Юрій"],
  ["Піцишину", "Піцишин Юрій"],
  ["Пайді", "Пайда Василь"],
  ["Кравцову", "Кравцов Віталій"],
] as const) {
  const r = await resolveStaff(q, ALL);
  check(`співробітник «${q}»`, r.ok && r.user.name === want, r.ok ? r.user.name : r.reason);
}
// «на слух» не повинно вгадувати, коли людей кілька
const many = await resolveStaff("Іван", ALL);
check("«Іван» не вгадує одного з кількох", !many.ok || many.user.name.includes("Іван"), many.ok ? many.user.name : `${many.reason}: ${many.candidates.length}`);

await prisma.$disconnect();

if (fails.length) {
  console.log(`\n${fails.length} провалено: ${fails.join("; ")}`);
  process.exit(1);
}
console.log("\nусе гаразд");
