/**
 * Відкат прибирання каталогу.
 *
 * Читає backup-файл, який залишив cleanup-catalog-noise.mjs, і повертає все
 * як було: фото з cdn.27.ua на місце, вимкнені картки — назад у каталог.
 *
 * Існує окремим скриптом навмисно: відкат потрібен саме тоді, коли щось
 * пішло не так, і в той момент ніхто не має писати UPDATE руками.
 *
 *   node scripts/rollback-catalog-cleanup.mjs scripts/backup-catalog-cleanup-2026-08-18.json
 *   node scripts/rollback-catalog-cleanup.mjs <файл> --apply
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";

const file = process.argv[2];
const APPLY = process.argv.includes("--apply");

if (!file || file.startsWith("--")) {
  console.error("вкажіть backup-файл: node scripts/rollback-catalog-cleanup.mjs <файл> [--apply]");
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const b = JSON.parse(readFileSync(file, "utf-8"));
  console.log(`бекап від ${b.at}`);
  console.log(`  фото до повернення:      ${b.photos.length}`);
  console.log(`  карток до увімкнення:    ${b.contractors.length + b.orphans.length}`);

  if (!APPLY) {
    console.log("\nпроба — нічого не записано. --apply щоб відкотити");
    return;
  }

  // Фото повертаємо поштучно: у кожного своя адреса, updateMany тут не годиться.
  let n = 0;
  for (let i = 0; i < b.photos.length; i += 200) {
    const part = b.photos.slice(i, i + 200);
    await prisma.$transaction(
      part.map((p) => prisma.product.update({ where: { id: p.id }, data: { image: p.image } }))
    );
    n += part.length;
  }
  console.log(`повернено фото: ${n}`);

  const ids = [...b.contractors, ...b.orphans].map((p) => p.id);
  n = 0;
  for (let i = 0; i < ids.length; i += 500) {
    await prisma.product.updateMany({
      where: { id: { in: ids.slice(i, i + 500) } },
      data: { isActive: true },
    });
    n += Math.min(500, ids.length - i);
  }
  console.log(`увімкнено карток: ${n}`);

  const active = await prisma.product.count({ where: { isActive: true } });
  console.log(`активних карток зараз: ${active}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
