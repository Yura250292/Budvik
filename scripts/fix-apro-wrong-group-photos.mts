/**
 * Ще два групові фото APRO, що показують не той товар.
 *
 * Та сама хвороба, що й у ключів (fix-apro-wrench-photos.mts): парсер бере
 * верхнє фото сторінки каталогу й вішає його на всю таблицю артикулів під
 * ним. Перебір усіх 52 групових фото APRO очима дав ще два промахи:
 *
 *   с.50, фото «830540.jpg» — насправді знімок набору кільцевих пил (той
 *   самий, що стоїть у 812030). Поїхало на 830545 «Чаша алмазна шліфувальна
 *   TL-образная»: покупець бачить кейс із коронками замість алмазної чаші.
 *
 *   с.59, фото «898901.jpg» — швидкозатискний патрон (гладкий, без вінця під
 *   ключ). Поїхало на всі 10 патронів сторінки, зокрема на пʼять, які саме
 *   «з ключем»: у них вінець із зубцями й отвори під ключ, тобто на фото
 *   інший товар. Самозатискним і швидкозатискним (898915, 898916, 898920,
 *   898921) це фото пасує — їх не чіпаємо.
 *
 * Фото знімаємо, а не підміняємо сусіднім: у 830540 власне фото чаші має на
 * диску напис «TC-подібна», а 830545 — це TL; у патронів «з ключем» рідні
 * знімки взагалі відсутні (проба сайту APRO їх не має). Порожня картка чесна,
 * чужа — ні. Обидві позиції чекають на власні знімки.
 *
 * Запобіжник: чіпаємо лише картки, у яких зараз стоїть саме те хибне фото.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/fix-apro-wrong-group-photos.mts           # звіт
 *   npx tsx --env-file=.env scripts/fix-apro-wrong-group-photos.mts --apply   # виправити
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const BASE = "https://files.budvik27.com/catalogs/apro/2024/photos";

/** Що знімаємо: артикул → фото, яке на ньому зараз стоїть помилково. */
const WRONG: { sku: string; photo: string; why: string }[] = [
  { sku: "830545", photo: `${BASE}/830540.jpg`, why: "набір кільцевих пил замість алмазної чаші" },
  ...["898901", "898902", "898903", "898904", "898910"].map((sku) => ({
    sku,
    photo: `${BASE}/898901.jpg`,
    why: "швидкозатискний патрон замість патрона з ключем",
  })),
];

const rows = await prisma.product.findMany({
  where: { sku: { in: WRONG.map((w) => w.sku) } },
  select: { id: true, sku: true, name: true, image: true },
  orderBy: { sku: "asc" },
});

const plan: typeof rows = [];
for (const w of WRONG) {
  const row = rows.find((r) => r.sku === w.sku);
  if (!row) {
    console.log(`пропуск ${w.sku}: картки немає на сайті`);
  } else if (row.image !== w.photo) {
    console.log(`пропуск ${w.sku}: фото вже інше (${row.image ?? "—"})`);
  } else {
    plan.push(row);
    console.log(`  ${w.sku} ${row.name.slice(0, 58)} — ${w.why}`);
  }
}

console.log(`\nЗняти фото: ${plan.length} карток`);
if (!APPLY) {
  console.log("Проба без змін. Запустіть із --apply, щоб застосувати.");
  await prisma.$disconnect();
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 10);
const backup = `scripts/backup-apro-wrong-group-photos-${stamp}.json`;
fs.writeFileSync(
  backup,
  JSON.stringify(plan.map((p) => ({ sku: p.sku, name: p.name, oldImage: p.image, newImage: null })), null, 1)
);
console.log(`Злі́пок старих фото: ${backup}`);

for (const p of plan) {
  await prisma.product.update({ where: { id: p.id }, data: { image: null } });
}
console.log(`Оновлено карток: ${plan.length}`);
await prisma.$disconnect();
