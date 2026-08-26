/**
 * Прописує наявні логотипи брендів.
 *
 * Запуск:
 *   npx tsx scripts/seed-brand-logos.ts
 *
 * У public/brands/ лежать шістнадцять файлів, але справжніх логотипів серед
 * них п'ять — решта це прямокутник із назвою шрифтом Arial, тобто гірше за
 * типографічну плитку, яку застосунок малює сам: та бере фірмовий колір
 * бренда й читається на будь-якому екрані.
 *
 * Тому прописуємо лише контурні. Решту 354 бренди застосунок покаже плиткою,
 * доки хтось не завантажить справжні логотипи — намалювати їх «схожими» не
 * можна, це чужі торгові марки.
 *
 * Скрипт ідемпотентний: запускати можна скільки завгодно.
 */
import { readdirSync, readFileSync } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

const DIR = path.join(process.cwd(), "public", "brands");
const SITE = "https://www.budvik27.com";

/** Логотип чи заглушка: у справжнього є контури, у заглушки лише <text>. */
function isRealLogo(file: string): boolean {
  return readFileSync(path.join(DIR, file), "utf-8").includes("<path");
}

async function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".svg"));
  const real = files.filter(isRealLogo);

  console.log(`файлів: ${files.length}, зі справжніми логотипами: ${real.length}`);

  let linked = 0;
  for (const file of real) {
    const slug = file.replace(/\.svg$/, "");
    const url = `${SITE}/brands/${file}`;

    const res = await p.brand.updateMany({
      where: { slug },
      data: { logoUrl: url },
    });

    if (res.count > 0) {
      console.log(`  ✓ ${slug} → ${url}`);
      linked += res.count;
    } else {
      console.log(`  • ${slug} — такого бренда в базі немає`);
    }
  }

  const total = await p.brand.count();
  const withLogo = await p.brand.count({ where: { logoUrl: { not: null } } });
  console.log(`\nпривʼязано: ${linked}`);
  console.log(`брендів із логотипом: ${withLogo} з ${total}; решта — плитка з назвою`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
