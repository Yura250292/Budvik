/**
 * Обнуляє залишок товарів, яких немає в 1С.
 *
 * Навіщо: істина про ціну й наявність живе в 1С, і синхронізація оновлює лише
 * ті ~20 тис. товарів, що прив'язані до неї через externalId. Решта ~29 тис. —
 * березневий імпорт зі старого прайсу, якого в 1С немає. Їхній залишок застиг
 * на значенні дня імпорту, і магазин показує «в наявності» для позицій, про
 * які облік нічого не знає. Це видно покупцю і псує замовлення.
 *
 * Що робить: ставить stock = 0 двом групам —
 *   1) товари без externalId (їх у 1С немає взагалі);
 *   2) товари, позначені нерозв'язаною розбіжністю MISSING / DELETED_IN_1C
 *      (були в 1С і зникли).
 * Разом із поскладовими рядками LocationStock, інакше наступний перерахунок
 * підняв би старе число назад.
 *
 * Чого НЕ робить: не деактивує і не видаляє. Товар лишається у вітрині —
 * сірим, без кнопки кошика, в кінці списку. Так вирішив власник: асортимент
 * видно, але магазин не обіцяє того, чого немає.
 *
 * Постійне правило для майбутніх зникнень живе в detectMissing()
 * (src/lib/sync-ingest/dispatch.ts) — цей скрипт лише розгрібає накопичене.
 *
 * Перед записом вивантажує бекап {id, sku, name, stock} у JSON поруч зі собою,
 * щоб відкат був можливий.
 *
 * Запуск (спершу без --apply — покаже, що саме зміниться):
 *   node --env-file=.env scripts/zero-stock-not-in-1c.mjs
 *   node --env-file=.env scripts/zero-stock-not-in-1c.mjs --apply
 *
 * Додатково --close-stale-discrepancies позначає розв'язаними розбіжності
 * price/stock/NEW, що лишились від preview-ери: бойовий режим пише напряму,
 * тому вони вже нічого не означають, але засмічують вкладку «Розбіжності».
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const closeStale = args.includes("--close-stale-discrepancies");

const num = (n) => Number(n ?? 0).toLocaleString("uk-UA");
const scriptDir = dirname(fileURLToPath(import.meta.url));

// --- Група 1: товарів немає в 1С узагалі --------------------------------------

const notIn1C = await prisma.product.findMany({
  where: { externalId: null, stock: { gt: 0 } },
  select: { id: true, sku: true, name: true, stock: true },
});

// --- Група 2: були в 1С і зникли ----------------------------------------------
//
// Розбіжність зберігає entityRef = sku (або externalId, якщо sku порожній),
// тому шукаємо товар за обома полями.

const missingRefs = await prisma.syncDiscrepancy.findMany({
  where: {
    entityType: "product",
    field: { in: ["MISSING", "DELETED_IN_1C"] },
    resolved: false,
  },
  select: { entityRef: true },
  distinct: ["entityRef"],
});

const refs = missingRefs.map((r) => r.entityRef);
const goneFrom1C = refs.length
  ? await prisma.product.findMany({
      where: {
        stock: { gt: 0 },
        OR: [{ sku: { in: refs } }, { externalId: { in: refs } }],
      },
      select: { id: true, sku: true, name: true, stock: true },
    })
  : [];

// --- Зведення ------------------------------------------------------------------

const byId = new Map();
for (const p of [...notIn1C, ...goneFrom1C]) byId.set(p.id, p);
const doomed = [...byId.values()];

const linkedTotal = await prisma.product.count({ where: { externalId: { not: null } } });
const linkedInStock = await prisma.product.count({
  where: { externalId: { not: null }, stock: { gt: 0 } },
});

console.log("=== Стан магазину ===");
console.log(`  Прив'язано до 1С:            ${num(linkedTotal)} (в наявності ${num(linkedInStock)})`);
console.log(`  Немає в 1С, показують запас: ${num(notIn1C.length)}`);
console.log(`  Зникли з 1С, показують запас:${num(goneFrom1C.length).padStart(7)}`);
console.log(`  Разом під обнулення:         ${num(doomed.length)}`);

if (doomed.length === 0) {
  console.log("\n✓ Магазин уже чесний: усі залишки підтверджені 1С.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log("\n=== Приклади (перші 15) ===");
for (const p of doomed.slice(0, 15)) {
  console.log(`  ${String(p.stock).padStart(6)} шт  ${(p.sku ?? "—").padEnd(12)} ${p.name.slice(0, 60)}`);
}
if (doomed.length > 15) console.log(`  … ще ${num(doomed.length - 15)}`);

if (!apply) {
  console.log("\nЦе пробний прогін. Нічого не змінено.");
  console.log("Для запису: node --env-file=.env scripts/zero-stock-not-in-1c.mjs --apply");
  await prisma.$disconnect();
  process.exit(0);
}

// --- Бекап ---------------------------------------------------------------------

const stamp = new Date().toISOString().slice(0, 10);
const backupPath = join(scriptDir, `backup-stock-not-in-1c-${stamp}.json`);
writeFileSync(backupPath, JSON.stringify(doomed, null, 2), "utf8");
console.log(`\nБекап: ${backupPath} (${num(doomed.length)} записів)`);

// --- Запис ---------------------------------------------------------------------

const ids = doomed.map((p) => p.id);
const CHUNK = 500;
let zeroed = 0;

for (let i = 0; i < ids.length; i += CHUNK) {
  const slice = ids.slice(i, i + CHUNK);
  await prisma.locationStock.updateMany({
    where: { productId: { in: slice } },
    data: { quantity: 0, reserved: 0, available: 0 },
  });
  const res = await prisma.product.updateMany({
    where: { id: { in: slice } },
    data: { stock: 0 },
  });
  zeroed += res.count;
  process.stdout.write(`\r  обнулено ${num(zeroed)} / ${num(ids.length)}`);
}
console.log();

// --- Гігієна розбіжностей (за прапорцем) ---------------------------------------

if (closeStale) {
  const res = await prisma.syncDiscrepancy.updateMany({
    where: { field: { in: ["price", "stock", "NEW"] }, resolved: false },
    data: { resolved: true },
  });
  console.log(`Закрито застарілих розбіжностей preview-ери: ${num(res.count)}`);
}

const left = await prisma.product.count({ where: { externalId: null, stock: { gt: 0 } } });
console.log(`\n✓ Обнулено ${num(zeroed)} товарів. Лишилось без 1С із запасом: ${num(left)}`);
console.log("Каталог оновиться протягом хвилини (ISR 60 с).");

await prisma.$disconnect();
