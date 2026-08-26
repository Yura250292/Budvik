/**
 * Публікація розібраного каталогу UNIFIX у R2.
 *
 * Навіщо: каталог постачальника — джерело фото і на майбутнє. Сьогодні в
 * ньому півсотні позицій, яких у нас ще немає; коли вони з'являться в 1С,
 * `sync.mts` підхопить фото звідси, а не з чийогось Downloads. Тому в R2
 * лягає все: сам PDF, фото і index.json з абсолютними посиланнями.
 *
 * Розкладка в бакеті (рік — рік каталогу, не публікації, щоб версії не
 * перекривали одна одну):
 *   catalogs/unifix/2025/catalog.pdf
 *   catalogs/unifix/2025/index.json
 *   catalogs/unifix/2025/photos/p46-63.jpg   ← одне фото на групу артикулів
 *   catalogs/unifix/latest.json              ← вказівник на свіжий індекс
 *
 * Фото названі за групою, а не за артикулом: у каталозі один знімок стоїть
 * на цілу таблицю варіантів (40 кольорів емалі — один балон), і 427 копій
 * тих самих 95 файлів у бакеті нікому не потрібні. Артикул → файл тримає
 * index.json.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/unifix-catalog/publish.mts \
 *     output/unifix-catalog/2025 --pdf ~/Downloads/Unifix_2025.pdf
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
const prefix = `catalogs/unifix/${year}`;
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

type Row = { article: string; photo: string | null; [k: string]: unknown };
type Group = { id: string; photo: string | null; [k: string]: unknown };
const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")) as {
  catalogYear: string;
  source: string;
  groups: Group[];
  rows: Row[];
};

const photos = [...new Set(index.groups.map((g) => g.photo).filter((p): p is string => !!p))];
console.log(`Каталог ${year}: ${index.rows.length} артикулів, ${photos.length} фото → ${prefix}/`);
await uploadAll(
  photos.map((p) => ({ key: `${prefix}/photos/${p}`, file: path.join(dir, "photos", p), type: "image/jpeg" }))
);

let pdfUrl: string | null = null;
if (pdf) {
  const size = fs.statSync(pdf).size;
  console.log(`PDF ${(size / 1e6).toFixed(1)} МБ → ${prefix}/catalog.pdf`);
  pdfUrl = await uploadFile(fs.readFileSync(pdf), `${prefix}/catalog.pdf`, "application/pdf");
}

const photoUrl = (photo: string | null) => (photo ? `${publicUrl}/${prefix}/photos/${photo}` : null);
const published = {
  brand: "UNIFIX",
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
  "catalogs/unifix/latest.json",
  "application/json"
);
console.log(`Готово: ${indexUrl}`);
console.log(`Вказівник: ${publicUrl}/catalogs/unifix/latest.json`);
