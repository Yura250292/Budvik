/**
 * Розкладання каталогу по розділах і групах.
 *
 * Запуск:
 *   npx tsx scripts/classify-catalog.mts            — показати, що зміниться
 *   npx tsx scripts/classify-catalog.mts --apply    — записати в базу
 *
 * Класифікатор живе в src/lib/catalog/classify.ts і рахує групу за назвою.
 * Тут його результат кладеться в Product.typeKey / Product.sectionId, бо
 * каталог фільтрує і гортає в SQL, а не в пам'яті.
 *
 * Запускати після кожної правки правил: обмін з 1С перекладає лише ті
 * товари, чия назва змінилась, і про нові правила нічого не знає.
 */

import { PrismaClient } from "@prisma/client";
import { classify, SECTIONS } from "../src/lib/catalog/classify";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, typeKey: true, sectionId: true, stock: true, price: true },
  });

  /** Групуємо по (розділ, група): один updateMany на групу замість 49 тис. запитів. */
  const buckets = new Map<string, string[]>();
  let changed = 0;
  let unknown = 0;
  let unknownInStock = 0;
  const bySection = new Map<string, number>();

  for (const p of products) {
    const c = classify(p.name);
    if (!c) {
      unknown++;
      if (p.stock > 0 && p.price > 0) unknownInStock++;
    }
    if (p.stock > 0 && p.price > 0) {
      const id = c?.section ?? "?";
      bySection.set(id, (bySection.get(id) || 0) + 1);
    }
    const type = c?.type ?? null;
    const section = c?.section ?? null;
    if (p.typeKey === type && p.sectionId === section) continue;
    changed++;
    const key = `${section ?? ""} ${type ?? ""}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(p.id);
  }

  console.log(`активних товарів: ${products.length}`);
  console.log(`без групи: ${unknown} (з них у наявності: ${unknownInStock})`);
  console.log(`оновити: ${changed} у ${buckets.size} групах`);

  console.log("\nу наявності по розділах:");
  for (const s of SECTIONS) {
    const n = bySection.get(s.id) || 0;
    if (n) console.log(`  ${String(n).padStart(5)}  ${s.title}`);
  }
  console.log(`  ${String(bySection.get("?") || 0).padStart(5)}  (без розділу)`);

  if (!APPLY) {
    console.log("\nПроба. Щоб записати: --apply");
    return;
  }

  let done = 0;
  for (const [key, ids] of buckets) {
    const [section, type] = key.split(" ");
    // Пачками по 1000: IN-список на 20 тис. ідентифікаторів Postgres приймає,
    // але план запиту від цього не кращий, а пам'ять драйвера — гірша.
    for (let i = 0; i < ids.length; i += 1000) {
      await prisma.product.updateMany({
        where: { id: { in: ids.slice(i, i + 1000) } },
        data: { sectionId: section || null, typeKey: type || null },
      });
    }
    done += ids.length;
  }
  console.log(`\nзаписано: ${done}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
