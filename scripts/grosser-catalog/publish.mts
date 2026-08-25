/**
 * Публікація розібраного каталогу Grösser у R2.
 *
 * Навіщо: каталог постачальника — джерело фото і на майбутнє. Сьогодні в
 * ньому ~50 позицій, яких у нас ще немає; коли вони з'являться в 1С,
 * `sync.mts` підхопить фото звідси, а не з чийогось Downloads. Тому в R2
 * лягає все: сам PDF, фото, таблиці характеристик і index.json з абсолютними
 * посиланнями.
 *
 * Розкладка в бакеті (дата — дата каталогу, не публікації, щоб версії не
 * перекривали одна одну):
 *   catalogs/grosser/2026-06-17/catalog.pdf
 *   catalogs/grosser/2026-06-17/index.json
 *   catalogs/grosser/2026-06-17/photos/G0362.jpg
 *   catalogs/grosser/2026-06-17/specs/G0362.png
 *   catalogs/grosser/latest.json          ← вказівник на свіжий індекс
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/grosser-catalog/publish.mts \
 *     output/grosser-catalog/2026-06-17 --pdf "~/Downloads/Grösser 17.06.26.pdf"
 */
import fs from "node:fs";
import path from "node:path";
import { uploadFile } from "../../src/lib/r2";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const pdfIdx = args.indexOf("--pdf");
const pdf = pdfIdx >= 0 ? args[pdfIdx + 1] : null;
if (!dir || !fs.existsSync(path.join(dir, "index.json"))) {
  console.error("Вкажіть теку з index.json (результат parse.py)");
  process.exit(1);
}

const date = path.basename(dir); // 2026-06-17
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`Назва теки має бути датою каталогу (YYYY-MM-DD), отримано «${date}»`);
  process.exit(1);
}
const prefix = `catalogs/grosser/${date}`;
const publicUrl = process.env.R2_PUBLIC_URL;
if (!publicUrl) throw new Error("R2_PUBLIC_URL не заданий");

const CONCURRENCY = 8;
async function uploadAll(items: { key: string; file: string; type: string }[]) {
  const queue = [...items];
  let done = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const it = queue.shift();
        if (!it) return;
        await uploadFile(fs.readFileSync(it.file), it.key, it.type);
        done++;
        if (done % 50 === 0) console.log(`  ${done}/${items.length}`);
      }
    })
  );
}

type Row = {
  article: string;
  photo: string | null;
  spec: string | null;
  [k: string]: unknown;
};
const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")) as {
  source: string;
  rows: Row[];
};

const files: { key: string; file: string; type: string }[] = [];
for (const r of index.rows) {
  if (r.photo) files.push({ key: `${prefix}/${r.photo}`, file: path.join(dir, r.photo), type: "image/jpeg" });
  if (r.spec) files.push({ key: `${prefix}/${r.spec}`, file: path.join(dir, r.spec), type: "image/png" });
}
console.log(`Каталог ${date}: ${index.rows.length} рядків, ${files.length} картинок → ${prefix}/`);
await uploadAll(files);

let pdfUrl: string | null = null;
if (pdf) {
  const size = fs.statSync(pdf).size;
  console.log(`PDF ${(size / 1e6).toFixed(1)} МБ → ${prefix}/catalog.pdf`);
  pdfUrl = await uploadFile(fs.readFileSync(pdf), `${prefix}/catalog.pdf`, "application/pdf");
}

const published = {
  brand: "Grösser",
  catalogDate: date,
  source: index.source,
  pdfUrl,
  publishedAt: new Date().toISOString(),
  rows: index.rows.map((r) => ({
    ...r,
    photoUrl: r.photo ? `${publicUrl}/${prefix}/${r.photo}` : null,
    specUrl: r.spec ? `${publicUrl}/${prefix}/${r.spec}` : null,
  })),
};
const indexUrl = await uploadFile(
  Buffer.from(JSON.stringify(published, null, 1)),
  `${prefix}/index.json`,
  "application/json"
);
await uploadFile(
  Buffer.from(JSON.stringify({ catalogDate: date, indexUrl, pdfUrl }, null, 1)),
  "catalogs/grosser/latest.json",
  "application/json"
);
console.log(`Готово: ${indexUrl}`);
console.log(`Вказівник: ${publicUrl}/catalogs/grosser/latest.json`);
