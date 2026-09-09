/**
 * Ключі APRO ріжково-накидні: зняти чуже фото з 13 карток.
 *
 * Що сталося: у каталозі APRO 2024 на с.75 над таблицею типорозмірів стоїть
 * фото сусіднього товару — набору насадок 251419 («219 шт.» у кейсі). Парсер
 * вважає верхнє фото сторінки фотом усієї таблиці, тож кейс на 219 предметів
 * поїхав на всі ключі 202206…202219 і на набори 202237-202239. Ті, у кого фото
 * вже було (202206, 202207, 202238, 202239, 251419), його зберегли — решта
 * лишилась із кейсом. Покупець бачив набір за 59,80 ₴.
 *
 * Що робимо:
 *   - 202208…202219 (ключ одного розміру) → фото ключа з картки 202206;
 *     каталог і сам дає одне фото на ряд типорозмірів, а тут воно правильне.
 *   - 202237 (набір 8 шт.) → знімаємо фото зовсім: фото набору 202238 підписане
 *     «12 pcs» і артикулом 202238, тобто збрехало б про склад набору.
 *
 * Запобіжник: чіпаємо лише картки, у яких зараз стоїть саме те хибне фото.
 * Якщо його вже замінили — скрипт нічого не робить.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/fix-apro-wrench-photos.mts           # звіт
 *   npx tsx --env-file=.env scripts/fix-apro-wrench-photos.mts --apply   # виправити
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

/** Фото набору насадок, що помилково поїхало на ключі. */
const WRONG = "https://files.budvik27.com/catalogs/apro/2024/photos/202206.jpg";
/** Звідки беремо правильне фото ключа. */
const DONOR_SKU = "202206";
/** Ключі одного розміру — їм ставимо фото ключа. */
const SINGLES = ["202208", "202209", "202210", "202211", "202212", "202213", "202214", "202215", "202216", "202217", "202218", "202219"];
/** Набори — фото немає, краще порожньо, ніж чуже. */
const CLEAR = ["202237"];

const donor = await prisma.product.findUnique({ where: { sku: DONOR_SKU }, select: { image: true, name: true } });
if (!donor?.image || donor.image === WRONG) {
  console.error(`У ${DONOR_SKU} немає власного фото ключа (зараз: ${donor?.image ?? "—"}) — брати нема звідки.`);
  process.exit(1);
}
console.log(`Донор ${DONOR_SKU}: ${donor.name}\n  ${donor.image}\n`);

const targets = await prisma.product.findMany({
  where: { sku: { in: [...SINGLES, ...CLEAR] } },
  select: { id: true, sku: true, name: true, image: true },
  orderBy: { sku: "asc" },
});

const plan = targets
  .filter((p) => p.image === WRONG)
  .map((p) => ({ ...p, next: CLEAR.includes(p.sku!) ? null : donor.image! }));

const skipped = targets.filter((p) => p.image !== WRONG);
for (const p of skipped) console.log(`пропуск ${p.sku}: фото вже інше (${p.image ?? "—"})`);

console.log(`\nДо зміни: ${plan.length} карток`);
for (const p of plan) console.log(`  ${p.sku} ${p.name.slice(0, 60)} → ${p.next ?? "без фото"}`);

if (!APPLY) {
  console.log("\nПроба без змін. Запустіть із --apply, щоб застосувати.");
  await prisma.$disconnect();
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 10);
const backup = `scripts/backup-apro-wrench-photos-${stamp}.json`;
fs.writeFileSync(
  backup,
  JSON.stringify(plan.map((p) => ({ sku: p.sku, name: p.name, oldImage: p.image, newImage: p.next })), null, 1)
);
console.log(`\nЗлі́пок старих фото: ${backup}`);

for (const p of plan) {
  await prisma.product.update({ where: { id: p.id }, data: { image: p.next } });
}
console.log(`Оновлено карток: ${plan.length}`);
await prisma.$disconnect();
