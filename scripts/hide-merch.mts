/**
 * Прибирає з вітрини мерч і рекламні матеріали: стенди, каталоги, футболки,
 * кепки, блокноти, ручки, брелоки з логотипом постачальника.
 *
 * Рішення власника 25.08.2026: такий товар на сайті не показувати. До цього
 * він або стояв з ціною 0 (і ховався сам), або — після появи розрахункового
 * роздрібу з опту — вилазив у видачу по 0,01 ₴ (сувеніри SOMA FIX) чи
 * 11 200 ₴ (стенд TOTAL).
 *
 * Дві групи:
 *   1. усе в категоріях, які isHiddenCategory() визнає службовими
 *      (стенди/реклама/сувенірка/обмінний фонд) — надалі обмін створює
 *      товари в них одразу неактивними;
 *   2. явний список артикулів мерчу, що лежить у «Імпорт з 1С» (SOMA FIX,
 *      STIHL) — за назвою їх не відрізнити від товару («Брелок» буває і
 *      ліхтариком, «Ручка» — і держаком).
 *
 * Обмін isActive не вмикає назад, тож деактивація тримається. Повернути
 * товар — галочкою в адмінці.
 *
 * Запуск: npx tsx --env-file=.env scripts/hide-merch.mts [--apply]
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { isHiddenCategory } from "../src/lib/catalog/category-display";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const MERCH_SKUS = [
  // SOMA FIX: сувеніри по 0,01 ₴ в 1С
  "63495", "97134", "48244", "83654-001", "83654-002", "83654-003", "83654-004", "83654-005",
  "63496", "64282", "70507", "70506", "59367001", "59367003", "59367004", "59367005",
  // STIHL: брелок, прапори, футболка
  "4209600002", "04633010018", "04633010017", "04640350007",
];

const categories = await prisma.category.findMany({ select: { id: true, name: true } });
const hiddenCats = categories.filter((c) => isHiddenCategory(c.name));
console.log("службові категорії:", hiddenCats.map((c) => c.name).join(" | "));

const products = await prisma.product.findMany({
  where: {
    isActive: true,
    OR: [{ categoryId: { in: hiddenCats.map((c) => c.id) } }, { sku: { in: MERCH_SKUS } }],
  },
  select: { id: true, sku: true, name: true, price: true, stock: true, category: { select: { name: true } } },
  orderBy: { name: "asc" },
});

console.log(`\nдо деактивації: ${products.length}`);
for (const p of products) {
  console.log(`  ${(p.sku ?? "").padEnd(24)} ${p.name.slice(0, 60).padEnd(61)} ${String(p.price).padStart(8)} ₴  зал ${String(p.stock).padStart(4)}  [${p.category.name}]`);
}

if (!apply) {
  console.log("\nРежим перегляду. Щоб записати: --apply");
  await prisma.$disconnect();
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 10);
fs.writeFileSync(`scripts/backup-hide-merch-${stamp}.json`, JSON.stringify(products.map((p) => ({ id: p.id, sku: p.sku, isActive: true })), null, 1));
const res = await prisma.product.updateMany({ where: { id: { in: products.map((p) => p.id) } }, data: { isActive: false } });
console.log(`\nдеактивовано: ${res.count}; бекап: scripts/backup-hide-merch-${stamp}.json`);
await prisma.$disconnect();
