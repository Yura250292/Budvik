/**
 * Пошук фото, які показують не той товар.
 *
 * Навіщо: у каталогах виробників один знімок законно стоїть на цілому ряду
 * типорозмірів, і саме через це чуже фото розходиться десятками карток
 * одразу — парсер бере верхнє фото сторінки й вішає на всю таблицю під ним.
 * Поодинокі фото (одне фото — одна картка) майже завжди зіставлені за
 * артикулом і помиляються рідко; ризик — у спільних.
 *
 * Два сита, бо жодне не ловить усього:
 *
 *   1) Автоматичне (`--mixed`): фото стоїть на товарах РІЗНИХ груп каталогу
 *      (Product.typeKey). Ловить «тріскавка на насадках», «щітка на
 *      шліфпапері» — і мовчить, коли обидва товари в одній групі.
 *   2) Контактні листи (`--sheets`) — для ока. Ловить те, що перше сито
 *      бачити не може: рулетка проти кутника, шпатель проти пензля, ключ
 *      ріжковий проти ріжково-накидного. Лист будує photo-audit-sheets.py.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/photo-audit.mts --mixed        # звіт по групах
 *   npx tsx --env-file=.env scripts/photo-audit.mts --sheets       # дані для листів
 *   npx tsx --env-file=.env scripts/photo-audit.mts --sheets --min 2
 *   npx tsx --env-file=.env scripts/photo-audit.mts --sheets --sample 72   # проба одинаків
 *   --out <тека>   куди класти json (типово output/photo-audit)
 *
 * Далі: python3 scripts/photo-audit-sheets.py output/photo-audit/<файл>.json <префікс>
 *
 * Нічого не змінює — лише читає. Виправлення роблять окремі скрипти
 * (fix-shared-photo-mismatches.mts і подібні), щоб рішення «чиє це фото»
 * лишалось за людиною.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const arg = (name: string, dflt?: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const OUT = arg("--out", "output/photo-audit")!;
const MIN = parseInt(arg("--min", "3")!, 10);
const SAMPLE = args.includes("--sample") ? parseInt(arg("--sample", "72")!, 10) : 0;
fs.mkdirSync(OUT, { recursive: true });

if (args.includes("--mixed")) {
  const rows = await prisma.$queryRawUnsafe<any[]>(`
    WITH g AS (
      SELECT image, "typeKey", count(*)::int AS n, min(sku) AS sku, min(name) AS name
      FROM "Product" WHERE "isActive" AND image IS NOT NULL AND "typeKey" IS NOT NULL
      GROUP BY image, "typeKey"
    )
    SELECT image, count(*)::int AS grup, sum(n)::int AS kartok,
           json_agg(json_build_object('typeKey', "typeKey", 'n', n, 'sku', sku, 'name', name) ORDER BY n DESC) AS rozklad
    FROM g GROUP BY image HAVING count(*) > 1 ORDER BY sum(n) DESC
  `);
  const file = path.join(OUT, "mixed-photos.json");
  fs.writeFileSync(file, JSON.stringify(rows, null, 1));
  console.log(`Фото на товарах різних груп: ${rows.length} (карток ${rows.reduce((s, r) => s + r.kartok, 0)}) → ${file}\n`);
  for (const r of rows) {
    console.log(`${r.image.split("/").slice(-2).join("/")}  ×${r.kartok}`);
    for (const g of r.rozklad) console.log(`   ${String(g.n).padStart(3)} ${g.typeKey.padEnd(22)} ${g.sku} ${g.name.slice(0, 52)}`);
  }
}

if (args.includes("--sheets")) {
  const rows = SAMPLE
    ? await prisma.$queryRawUnsafe<any[]>(
        `WITH one AS (
           SELECT image FROM "Product" WHERE "isActive" AND image IS NOT NULL
           GROUP BY image HAVING count(*) = 1
         )
         SELECT p.image, 1 AS n, array[p.name] AS names, array[p.sku] AS skus, b.name AS brand
         FROM "Product" p JOIN one ON one.image = p.image LEFT JOIN "Brand" b ON b.id = p."brandId"
         WHERE p."isActive" ORDER BY md5(p.sku || $1::text) LIMIT $2::int`,
        new Date().toISOString().slice(0, 10), SAMPLE
      )
    : await prisma.$queryRawUnsafe<any[]>(
        `SELECT p.image, count(*)::int AS n,
                array_agg(p.name ORDER BY p.sku) AS names,
                array_agg(p.sku  ORDER BY p.sku) AS skus,
                min(b.name) AS brand
         FROM "Product" p LEFT JOIN "Brand" b ON b.id = p."brandId"
         WHERE p."isActive" AND p.image IS NOT NULL
         GROUP BY p.image HAVING count(*) >= $1::int
         ORDER BY count(*) DESC`,
        MIN
      );
  const file = path.join(OUT, SAMPLE ? "sample-photos.json" : `shared-photos-min${MIN}.json`);
  fs.writeFileSync(file, JSON.stringify(rows, null, 1));
  console.log(`Фото до перегляду: ${rows.length} (карток ${rows.reduce((s, r) => s + r.n, 0)}) → ${file}`);
  console.log(`Далі: python3 scripts/photo-audit-sheets.py ${file} ${SAMPLE ? "sample" : "shared"}`);
}

if (!args.includes("--mixed") && !args.includes("--sheets")) {
  console.log("Вкажіть --mixed (сито по групах) або --sheets (дані для контактних листів).");
}
await prisma.$disconnect();
