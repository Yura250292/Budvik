/**
 * Знімає з товарів СИЛА фото-обманку, що приїхала з розбору сайту 27.08.2026.
 *
 * Що сталося: конвеєр `scripts/vendor-catalog/` для СИЛА захопив не фото
 * товару, а фоновий елемент сторінки — чорно-білий візерунок із хрестових
 * балонних ключів. Усі 96 показних товарів партії
 * `catalogs/sila/site-2026-08-27` отримали картинку 55×54 пікселі вагою 2 КБ.
 *
 * На вітрині це виглядає так: «СИЛА Ніж складаний Рибак», «СИЛА Рівень з
 * поворотною капсулою», «СИЛА Ліхтар для кемпінгу», «СИЛА Килимок для пікніку»
 * — і в усіх один орнамент. Покупець бачить не той товар, який купує.
 *
 * Рішення: `image = NULL`. Заглушка `NoPhoto` покаже назву бренда й напис
 * «Фото готуємо» — це чесніше за чужу картинку. Так само 18.08.2026 вчинили
 * з тисячею фото cdn.27.ua (див. scripts/cleanup-catalog-noise.mjs).
 *
 * Поріг 120 px, а не «усі з цієї партії»: якщо в партії трапиться справжнє
 * фото, воно лишиться. Заміряно — у всіх 96 рівно 55×54.
 *
 *   npx tsx --env-file=.env scripts/fix-sila-placeholder-photos.mts          # проба
 *   npx tsx --env-file=.env scripts/fix-sila-placeholder-photos.mts --apply  # застосувати
 *
 * Відкат: backup-sila-photos-<дата>.json поруч зі скриптом.
 */

import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const HERE = dirname(fileURLToPath(import.meta.url));

/** Більша сторона, нижче якої це вже не фото товару, а іконка чи візерунок. */
const TOO_SMALL = 120;

/** Партії, зібрані розбором сайту виробника, — саме там трапилась підміна. */
const SUSPECT_PATH = "%/catalogs/sila/site-%";

type Row = { id: string; slug: string; name: string; image: string };

async function main() {
  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT id, slug, name, image FROM "Product"
    WHERE "isActive" AND image IS NOT NULL AND image <> '' AND image LIKE $1
  `, SUSPECT_PATH);

  console.log(`Товарів у підозрілій партії: ${rows.length}`);
  if (rows.length === 0) return;

  const doomed: (Row & { w: number; h: number; bytes: number })[] = [];
  const kept: string[] = [];

  for (let i = 0; i < rows.length; i += 12) {
    await Promise.all(rows.slice(i, i + 12).map(async (r) => {
      try {
        const res = await fetch(r.image);
        if (!res.ok) return;
        const buf = Buffer.from(await res.arrayBuffer());
        const md = await sharp(buf).metadata();
        const side = Math.max(md.width ?? 0, md.height ?? 0);
        if (side > 0 && side <= TOO_SMALL) doomed.push({ ...r, w: md.width!, h: md.height!, bytes: buf.length });
        else kept.push(`${side}px ${r.name.slice(0, 50)}`);
      } catch {
        /* недоступне фото — не наша справа тут */
      }
    }));
    process.stderr.write(`\rвиміряно ${Math.min(i + 12, rows.length)}/${rows.length}`);
  }

  console.log(`\n\nПід зняття (≤${TOO_SMALL}px): ${doomed.length}`);
  for (const d of doomed.slice(0, 10)) console.log(`   ${d.w}×${d.h} ${(d.bytes / 1024).toFixed(0)}КБ  ${d.name.slice(0, 58)}`);
  if (doomed.length > 10) console.log(`   … і ще ${doomed.length - 10}`);
  if (kept.length) {
    console.log(`\nЛишаємо (справжні фото): ${kept.length}`);
    for (const k of kept.slice(0, 5)) console.log(`   ${k}`);
  }

  if (!APPLY) {
    console.log("\nПроба. Щоб застосувати — той самий виклик із --apply");
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const backup = join(HERE, `backup-sila-photos-${stamp}.json`);
  writeFileSync(backup, JSON.stringify(doomed.map((d) => ({ id: d.id, slug: d.slug, image: d.image })), null, 2));
  console.log(`\nРезервна копія: ${backup}`);

  const res = await prisma.product.updateMany({
    where: { id: { in: doomed.map((d) => d.id) } },
    data: { image: null },
  });
  console.log(`Знято фото у ${res.count} товарів. Заглушка NoPhoto покаже бренд і «Фото готуємо».`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
