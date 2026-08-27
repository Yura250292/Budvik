/**
 * Публікація розібраного каталогу «СИЛА» у R2.
 *
 * Навіщо архів, а не просто фото в базі: каталог — джерело і на майбутнє.
 * Позиції, яких сьогодні немає в 1С, лежатимуть в індексі, і коли облік їх
 * заведе, `sync.mts` підхопить фото звідси, а не з чийогось Downloads.
 *
 * Розкладка в бакеті (рік — рік каталогу, щоб видання не перекривали одне
 * одного):
 *   catalogs/syla/2026/catalog.pdf
 *   catalogs/syla/2026/index.json
 *   catalogs/syla/2026/photos/202511.jpg   ← один файл на знімок
 *   catalogs/syla/latest.json              ← вказівник на свіже видання
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/syla-catalog/publish.mts \
 *     output/syla-catalog/2026 --pdf "~/Downloads/Каталог СИЛА 2026 весна-літо.pdf"
 */
import fs from "node:fs";
import path from "node:path";
import { uploadFile } from "../../src/lib/r2";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const pdfIdx = args.indexOf("--pdf");
const pdf = pdfIdx >= 0 ? args[pdfIdx + 1]?.replace(/^~/, process.env.HOME ?? "~") : null;
if (!dir || !fs.existsSync(path.join(dir, "index.json"))) {
  console.error("Вкажіть теку з index.json (результат parse.py)");
  process.exit(1);
}

const year = path.basename(dir);
if (!/^\d{4}$/.test(year)) {
  console.error(`Назва теки має бути роком каталогу (YYYY), отримано «${year}»`);
  process.exit(1);
}
const prefix = `catalogs/syla/${year}`;
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
        if (done % 25 === 0) console.log(`  ${done}/${items.length}`);
      }
    })
  );
}

type WithPhoto = { photo: string | null; [k: string]: unknown };
const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")) as {
  catalogYear: string;
  source: string;
  groups: WithPhoto[];
  rows: WithPhoto[];
};

const photos = [...new Set(index.groups.map((g) => g.photo).filter((p): p is string => !!p))];
console.log(`Каталог ${year}: ${index.rows.length} артикулів, ${photos.length} фото → ${prefix}/`);
await uploadAll(
  photos.map((p) => ({ key: `${prefix}/photos/${p}`, file: path.join(dir, "photos", p), type: "image/jpeg" }))
);

let pdfUrl: string | null = null;
if (pdf) {
  console.log(`PDF ${(fs.statSync(pdf).size / 1e6).toFixed(1)} МБ → ${prefix}/catalog.pdf`);
  pdfUrl = await uploadFile(fs.readFileSync(pdf), `${prefix}/catalog.pdf`, "application/pdf");
}

const photoUrl = (photo: string | null) => (photo ? `${publicUrl}/${prefix}/photos/${photo}` : null);
const published = {
  brand: "СИЛА",
  catalogYear: year,
  source: index.source,
  pdfUrl,
  publishedAt: new Date().toISOString(),
  groups: index.groups.map((g) => ({ ...g, photoUrl: photoUrl(g.photo) })),
  rows: index.rows.map((r) => ({ ...r, photoUrl: photoUrl(r.photo) })),
};
const indexUrl = await uploadFile(
  Buffer.from(JSON.stringify(published, null, 1)),
  `${prefix}/index.json`,
  "application/json"
);
await uploadFile(
  Buffer.from(JSON.stringify({ catalogYear: year, indexUrl, pdfUrl }, null, 1)),
  "catalogs/syla/latest.json",
  "application/json"
);
console.log(`Готово: ${indexUrl}`);
console.log(`Вказівник: ${publicUrl}/catalogs/syla/latest.json`);
