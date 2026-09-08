/**
 * Контрагенти, що потрапили в товари, — прибрати з каталогу.
 *
 * У таблиці товарів лежать рядки з іменами людей і фірм: «Мартинишин В.
 * (Золочів)», «Олег Мартиненко», обʼєднання співвласників. Це не товари, а
 * контрагенти, що колись приїхали не в ту таблицю. У магазин вони не
 * потрапляють (нуль на складі), зате засмічують внутрішній пошук: на
 * питання «скажи артикул» помічник показав вісьмох Мартинюків у таблиці
 * товарів, бо коротка основа «арти» збіглася з їхніми прізвищами.
 *
 * ОЗНАКА ТОЧНА, А НЕ ЗА ВІЗЕРУНКОМ. Спокусливо взяти «артикул із нулів
 * на початку», але під це підпадають і справжні товари: STIHL 00008935903,
 * SIGMA 0000104 «Стенд торгівельний». Тому єдина ознака — артикул товару
 * ДОСЛІВНО збігається з кодом наявного контрагента. Плюс два запобіжники:
 * нуль на складі й нуль у ціні, щоб жодна позиція, якою реально торгують,
 * не зникла навіть при випадковому збігу коду.
 *
 * Ховаємо так само, як мерч (hide-merch.mts): isActive = false. Обмін з 1С
 * назад його не вмикає, тож деактивація тримається; повернути можна з
 * резервної копії, яку скрипт пише поруч.
 *
 *   npx tsx --env-file=.env scripts/hide-counterparty-products.mts
 *   npx tsx --env-file=.env scripts/hide-counterparty-products.mts --apply
 */

import fs from "node:fs";
import { prisma } from "../src/lib/prisma";

const apply = process.argv.includes("--apply");

const codes = new Set(
  (await prisma.counterparty.findMany({ select: { code: true } }))
    .map((c) => c.code)
    .filter((c): c is string => Boolean(c))
);

const active = await prisma.product.findMany({
  where: { isActive: true, stock: 0, price: 0, sku: { not: null } },
  select: { id: true, sku: true, name: true, category: { select: { name: true } } },
});

const hits = active.filter((p) => p.sku && codes.has(p.sku));

console.log(`кодів контрагентів: ${codes.size}`);
console.log(`активних товарів без залишку й ціни: ${active.length}`);
console.log(`з них збігаються з кодом контрагента: ${hits.length}\n`);

for (const p of hits.slice(0, 15)) {
  console.log(`  ${p.sku}  ${p.name.slice(0, 52)}  [${p.category?.name ?? "без категорії"}]`);
}
if (hits.length > 15) console.log(`  … і ще ${hits.length - 15}`);

if (hits.length === 0) {
  console.log("\nНічого ховати.");
  await prisma.$disconnect();
  process.exit(0);
}

if (!apply) {
  console.log("\nРежим перегляду — у базу нічого не записано. Щоб записати: --apply");
  await prisma.$disconnect();
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 10);
const backup = `scripts/backup-hide-counterparty-products-${stamp}.json`;
fs.writeFileSync(
  backup,
  JSON.stringify(hits.map((p) => ({ id: p.id, sku: p.sku, name: p.name, isActive: true })), null, 1)
);

const res = await prisma.product.updateMany({
  where: { id: { in: hits.map((p) => p.id) } },
  data: { isActive: false },
});

console.log(`\nСховано ${res.count}. Резервна копія: ${backup}`);
await prisma.$disconnect();
