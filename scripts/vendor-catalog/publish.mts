/**
 * Вивантаження зібраного з сайту виробника в R2.
 *
 * Навіщо копіювати до себе, а не посилатися на чужий сайт: посилання живе
 * рівно доти, доки постачальник не перебудує сайт, — а картка товару має
 * працювати й після цього. Тому фото лягають у наш бакет.
 *
 * Розкладка (окремо від каталогів-PDF, щоб не перетерти те, що вже лежить під
 * catalogs/<бренд>/<рік>/ від розбору буклетів):
 *   catalogs/<джерело>/site-<дата>/index.json
 *   catalogs/<джерело>/site-<дата>/photos/D-18677.jpg
 *   catalogs/<джерело>/site-latest.json      ← вказівник на свіжий індекс
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/vendor-catalog/publish.mts makita
 *   --dir <тека>   інша тека (типово output/vendor-<джерело>/<остання дата>)
 */
import fs from "node:fs";
import path from "node:path";
import { uploadFile } from "../../src/lib/r2";
import { vendorBySlug, type Specs } from "./vendors";

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : null);
const slug = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
if (!slug) throw new Error("вкажіть джерело, напр. makita");
const vendor = vendorBySlug(slug);

function latestDir(): string {
  const root = `output/vendor-${vendor.slug}`;
  const dates = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
  if (!dates.length) throw new Error(`немає зібраного: ${root}/<дата>`);
  return path.join(root, dates[dates.length - 1]);
}
const dir = opt("dir") ?? latestDir();
const version = path.basename(dir);
if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) throw new Error(`назва теки має бути датою збору, отримано «${version}»`);

const publicUrl = process.env.R2_PUBLIC_URL;
if (!publicUrl) throw new Error("R2_PUBLIC_URL не заданий");
const prefix = `catalogs/${vendor.slug}/site-${version}`;

type Row = { article: string; vendorArticle: string; title: string; photo: string | null; source: string; specs: Specs; text: string | null; description: string };
const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")) as {
  vendor: string; brand: string; source: string; rows: Row[];
};

const missing = index.rows.filter((r) => r.photo && !fs.existsSync(path.join(dir, r.photo)));
if (missing.length) {
  console.error(`Немає ${missing.length} файлів, на які посилається index.json:`);
  for (const m of missing.slice(0, 10)) console.error(`  ${path.join(dir, m.photo!)}`);
  process.exit(1);
}

const INDEX_ONLY = args.includes("--index-only"); // фото вже в R2, оновлюємо лише опис
console.log(`${vendor.title} (${version}): ${index.rows.length} карток → ${prefix}/`);
let done = 0;
for (const r of INDEX_ONLY ? [] : index.rows.filter((r) => r.photo)) {
  const type = r.photo!.endsWith(".png") ? "image/png" : r.photo!.endsWith(".webp") ? "image/webp" : "image/jpeg";
  await uploadFile(fs.readFileSync(path.join(dir, r.photo!)), `${prefix}/${r.photo}`, type);
  if (++done % 50 === 0) console.log(`  ${done}/${index.rows.length}`);
}
console.log(`  вивантажено фото: ${done}`);

const published = {
  vendor: vendor.slug,
  brand: index.brand,
  brands: vendor.brands,
  source: index.source,
  catalogDate: version,
  publishedAt: new Date().toISOString(),
  rows: index.rows.map((r) => ({ ...r, photoUrl: r.photo ? `${publicUrl}/${prefix}/${r.photo}` : null })),
};
const indexUrl = await uploadFile(Buffer.from(JSON.stringify(published, null, 1)), `${prefix}/index.json`, "application/json");
await uploadFile(
  Buffer.from(JSON.stringify({ vendor: vendor.slug, catalogDate: version, indexUrl, count: index.rows.length }, null, 1)),
  `catalogs/${vendor.slug}/site-latest.json`,
  "application/json"
);
console.log(`Готово: ${indexUrl}`);
console.log(`Вказівник: ${publicUrl}/catalogs/${vendor.slug}/site-latest.json`);
