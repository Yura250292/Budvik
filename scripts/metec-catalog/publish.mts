/**
 * Публікація каталогу METEC у R2.
 *
 * Розкладка в бакеті:
 *   catalogs/metec/2026/catalog.pdf
 *   catalogs/metec/2026/index.json
 *   catalogs/metec/2026/photos/700112.jpg   ← знімок названо артикулом
 *   catalogs/metec/latest.json              ← вказівник на свіже видання
 *
 * Файли знімків з parse.py названі за сторінкою (`p3.jpg`), а в бакет
 * кладемо їх під артикулом: сторінка — це верстка, вона поїде в наступному
 * виданні, а артикул лишається. Розгортки сторінок (`pages/`) у R2 не
 * вивантажуємо: вони потрібні були лише як вхід для зору.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/metec-catalog/publish.mts \
 *     output/metec-catalog/2026 --pdf "~/Downloads/Каталог METEC.pdf"
 */
import fs from "node:fs";
import path from "node:path";
import { uploadFile } from "../../src/lib/r2";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const pdfIdx = args.indexOf("--pdf");
const pdf = pdfIdx >= 0 ? args[pdfIdx + 1]?.replace(/^~/, process.env.HOME ?? "~") : null;
if (!dir || !fs.existsSync(path.join(dir, "index.json"))) {
  console.error("Вкажіть теку з index.json (результат parse.py + read.mts)");
  process.exit(1);
}

const year = path.basename(dir);
if (!/^\d{4}$/.test(year)) {
  console.error(`Назва теки має бути роком каталогу (YYYY), отримано «${year}»`);
  process.exit(1);
}
const prefix = `catalogs/metec/${year}`;
const publicUrl = process.env.R2_PUBLIC_URL;
if (!publicUrl) throw new Error("R2_PUBLIC_URL не заданий");

type Read = {
  article: string | null;
  name: string;
  model: string | null;
  specs: { key: string; value: string }[];
  features: string[];
};
type Page = { page: number; photo: string; sheet: string; px: number[]; read?: Read };
const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")) as {
  catalogYear: string;
  source: string;
  pages: Page[];
};

const ready = index.pages.filter((p) => p.read?.article);
const missing = index.pages.filter((p) => !p.read?.article);
if (missing.length) {
  console.log(`Без артикулу (не вивантажуємо): ${missing.map((p) => `стор.${p.page}`).join(", ")}`);
}
if (!ready.length) {
  console.error("Жодної сторінки з артикулом — спершу read.mts");
  process.exit(1);
}

const CONCURRENCY = 8;
let done = 0;
const queue = ready.map((p) => ({ page: p, key: `${prefix}/photos/${p.read!.article}.jpg` }));
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const it = queue.shift();
      if (!it) return;
      await uploadFile(fs.readFileSync(path.join(dir, "photos", it.page.photo)), it.key, "image/jpeg");
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${ready.length}`);
    }
  })
);
console.log(`Каталог ${year}: ${ready.length} товарів → ${prefix}/`);

let pdfUrl: string | null = null;
if (pdf) {
  console.log(`PDF ${(fs.statSync(pdf).size / 1e6).toFixed(1)} МБ → ${prefix}/catalog.pdf`);
  pdfUrl = await uploadFile(fs.readFileSync(pdf), `${prefix}/catalog.pdf`, "application/pdf");
}

const published = {
  brand: "METEC",
  catalogYear: year,
  source: index.source,
  pdfUrl,
  publishedAt: new Date().toISOString(),
  rows: ready.map((p) => ({
    article: p.read!.article!,
    page: p.page,
    name: p.read!.name,
    model: p.read!.model,
    specs: p.read!.specs,
    features: p.read!.features,
    px: p.px,
    photoUrl: `${publicUrl}/${prefix}/photos/${p.read!.article}.jpg`,
  })),
};
const indexUrl = await uploadFile(
  Buffer.from(JSON.stringify(published, null, 1)),
  `${prefix}/index.json`,
  "application/json"
);
await uploadFile(
  Buffer.from(JSON.stringify({ catalogYear: year, indexUrl, pdfUrl }, null, 1)),
  "catalogs/metec/latest.json",
  "application/json"
);
console.log(`Готово: ${indexUrl}`);
console.log(`Вказівник: ${publicUrl}/catalogs/metec/latest.json`);
