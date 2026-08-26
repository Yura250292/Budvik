/**
 * Заливає логотипи брендів у R2 і привʼязує їх до брендів.
 *
 * Запуск:
 *   npx tsx scripts/upload-brand-logos.ts <тека>
 *
 * У теці мають лежати файли, названі slug-ом бренда: sigma.png, polax.svg.
 * Slug той самий, що в адресі бренда на сайті — його видно в /admin або в
 * посиланні /brand/<slug>.
 *
 * Звідки брати самі файли: найкраще джерело — каталог постачальника в PDF.
 * Там логотип векторний, у правильних кольорах і від самого виробника;
 * витягує його scripts/extract-brand-logos.py. Вирізати з фотографії коробки
 * не варто — це перекошений растр із відблиском, часто ще й із чужим водяним
 * знаком.
 *
 * Скрипт ідемпотентний: перезапуск просто перезаписує ті самі ключі.
 */
import { readdirSync } from "fs";
import { readFile } from "fs/promises";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { uploadFile } from "@/lib/r2";

const p = new PrismaClient();

const dir = process.argv[2];
if (!dir) {
  console.error("Вкажіть теку з файлами, названими slug-ом бренда");
  process.exit(1);
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

async function main() {
  const files = readdirSync(dir).filter((f) => MIME[path.extname(f).toLowerCase()]);
  if (files.length === 0) {
    console.log("У теці немає придатних файлів");
    return;
  }

  let linked = 0;
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const slug = path.basename(file, ext);

    const brand = await prismaBrand(slug);
    if (!brand) {
      console.log(`  • ${slug} — такого бренда в базі немає, пропускаю`);
      continue;
    }

    const buf = await readFile(path.join(dir, file));
    /**
     * Ключ без версії: логотип бренда змінюється раз на кілька років, а
     * версіонування вимагало б щоразу правити logoUrl у базі. Перезапис під
     * тим самим ключем простіший, а CDN оновиться протягом години.
     */
    const url = await uploadFile(buf, `brands/${slug}${ext}`, MIME[ext]);

    await p.brand.update({ where: { id: brand.id }, data: { logoUrl: url } });
    console.log(`  ✓ ${brand.name} (${(buf.length / 1024).toFixed(0)} КБ) → ${url}`);
    linked++;
  }

  const withLogo = await p.brand.count({ where: { logoUrl: { not: null } } });
  const total = await p.brand.count();
  console.log(`\nпривʼязано цього разу: ${linked}`);
  console.log(`брендів із логотипом: ${withLogo} з ${total}; решта — плитка з назвою`);
}

/** Шукаємо і за slug, і за назвою: файли часто називають так, як бренд зветься. */
async function prismaBrand(key: string) {
  return (
    (await p.brand.findUnique({ where: { slug: key }, select: { id: true, name: true } })) ??
    (await p.brand.findFirst({
      where: { name: { equals: key, mode: "insensitive" } },
      select: { id: true, name: true },
    }))
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
