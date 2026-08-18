/**
 * Прибирання з каталогу того, чого в нас немає.
 *
 * Три різні проблеми, які покупець бачить як одну — «сайт показує казна-що»:
 *
 *   А. Фото з cdn.27.ua (1 006) — водяний знак Епіцентру, а в більшості
 *      випадків ще й чужий товар (перевірка зором 18.08.2026: з 9 випадкових
 *      правильними були 2-3). Знімаємо фото, картка лишається — заглушка
 *      NoPhoto покаже бренд.
 *
 *   Б. Записи-контрагенти з 1С (~890) — «Ковалишин М. (м.Львів)» приїхало у
 *      номенклатуру як товар. Пастка: «(м.» буває і в справжніх товарів, де
 *      це МІСТО ВИРОБНИЦТВА («Кукурудзолущілка ручна (м.Вінниця)»). Тому
 *      вимикаємо лише те, що водночас без ціни, без залишку і без жодного
 *      замовлення.
 *
 *   В. Картки без звʼязку з 1С (25 709) — залишки старого сайту. У них немає
 *      Ref_Key, тож синхронізація їх не бачить і залишок вони не отримають
 *      ніколи. За весь час із них замовили 18 позицій.
 *
 * Нічого не видаляємо: фото — у NULL, картки — у isActive=false. Старі
 * значення лягають у backup-файл, відкат — один UPDATE зі збереженого.
 *
 *   node scripts/cleanup-catalog-noise.mjs           проба
 *   node scripts/cleanup-catalog-noise.mjs --apply   запис
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

/** Контрагент, а не товар: назва як у людини, і жодних ознак товару. */
const CONTRACTOR_SQL = `
  ("name" ~ '\\(м\\.' OR "description" LIKE 'Замовлення%')
  AND price = 0
  AND stock = 0
  AND NOT EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."productId" = "Product".id)
`;

async function main() {
  const backup = { at: new Date().toISOString(), photos: [], contractors: [], orphans: [] };

  // ── А. Фото з водяним знаком ──────────────────────────────────────────
  const photos = await prisma.$queryRawUnsafe(`
    SELECT id, sku, name, image FROM "Product"
    WHERE image LIKE '%cdn.27.ua%'`);
  backup.photos = photos.map((p) => ({ id: p.id, image: p.image }));

  // ── Б. Записи-контрагенти ─────────────────────────────────────────────
  const contractors = await prisma.$queryRawUnsafe(`
    SELECT id, name FROM "Product"
    WHERE "isActive" AND ${CONTRACTOR_SQL}`);
  backup.contractors = contractors.map((p) => ({ id: p.id, name: p.name }));

  // ── В. Картки без джерела істини ──────────────────────────────────────
  // Виключаємо вже пораховані в Б, щоб не рахувати двічі, і підстраховуємось
  // залишком: якщо товар раптом на складі — він лишається в каталозі.
  const orphans = await prisma.$queryRawUnsafe(`
    SELECT id, name FROM "Product"
    WHERE "isActive"
      AND "syncSource" IS DISTINCT FROM '1C'
      AND stock <= 0
      AND NOT (${CONTRACTOR_SQL})`);
  backup.orphans = orphans.map((p) => ({ id: p.id, name: p.name }));

  const ordered = await prisma.$queryRawUnsafe(`
    SELECT count(DISTINCT p.id) n FROM "Product" p
    JOIN "OrderItem" oi ON oi."productId" = p.id
    WHERE p."isActive" AND p."syncSource" IS DISTINCT FROM '1C' AND p.stock <= 0`);

  console.log(`А. фото з cdn.27.ua:        ${photos.length}`);
  console.log(`Б. записи-контрагенти:      ${contractors.length}`);
  console.log(`В. картки без звʼязку з 1С: ${orphans.length}  (з них колись замовляли: ${Number(ordered[0].n)})`);

  console.log("\nЗалишаються в каталозі попри збіг за назвою (місто виробництва):");
  const kept = await prisma.$queryRawUnsafe(`
    SELECT name, price FROM "Product"
    WHERE "isActive" AND ("name" ~ '\\(м\\.' OR "description" LIKE 'Замовлення%') AND price > 0`);
  kept.forEach((k) => console.log(`  ${k.name} — ${k.price} ₴`));

  if (!APPLY) {
    console.log("\nпроба — нічого не записано. --apply щоб застосувати");
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const file = `scripts/backup-catalog-cleanup-${stamp}.json`;
  writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\nбекап: ${file}`);

  const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

  let done = 0;
  for (const part of chunk(backup.photos.map((p) => p.id), 500)) {
    await prisma.product.updateMany({ where: { id: { in: part } }, data: { image: null } });
    done += part.length;
  }
  console.log(`А. знято фото: ${done}`);

  const off = [...backup.contractors, ...backup.orphans].map((p) => p.id);
  done = 0;
  for (const part of chunk(off, 500)) {
    await prisma.product.updateMany({ where: { id: { in: part } }, data: { isActive: false } });
    done += part.length;
    if (done % 5000 === 0) console.log(`  вимкнено ${done}/${off.length}`);
  }
  console.log(`Б+В. вимкнено карток: ${done}`);

  const left = await prisma.product.count({ where: { isActive: true } });
  const inStock = await prisma.product.count({ where: { isActive: true, stock: { gt: 0 } } });
  const withImg = await prisma.product.count({ where: { isActive: true, stock: { gt: 0 }, NOT: { image: null } } });
  console.log(`\nактивних карток: ${left}, з них у наявності: ${inStock}, з фото: ${withImg}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
