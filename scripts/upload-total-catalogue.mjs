/**
 * Завантаження офіційного каталогу TOTAL у R2 — архів «на майбутнє».
 *
 * Навіщо: у каталозі 1,2 тис. позицій, а в нас поки ~430. Коли 1С привезе
 * нову позицію TOTAL, фото й характеристики для неї вже лежатимуть у нашому
 * сховищі — досить перезапустити scripts/sync-total-catalogue.mjs.
 *
 * Розкладка в бакеті (R2_BUCKET_NAME):
 *   catalogues/total/2026/TOTAL-catalogue-2026-2027-ua.pdf   — сам каталог (551 МБ)
 *   catalogues/total/2026/index.json                          — розбір: артикул, назва,
 *                                                                характеристики, пакування
 *   catalogues/total/2026/images/<АРТИКУЛ>.jpg                — фото з каталогу
 *
 * Вхід — тека, яку зробив scripts/parse-total-catalogue.py (index.json + images/).
 * Безпечний до перезапуску: перед кожним об'єктом питає HEAD і пропускає наявні
 * (--force перезаливає). PDF іде multipart-частинами, бо один PUT на пів
 * гігабайта через SDK легко обривається й повторюється з нуля.
 *
 * Запуск: node --env-file=.env scripts/upload-total-catalogue.mjs <тека-розбору> <каталог.pdf> [--force]
 */
import {
  S3Client, PutObjectCommand, HeadObjectCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import fs from "node:fs";
import path from "node:path";

const CATALOGUE_PREFIX = "catalogues/total/2026";
const PDF_KEY = `${CATALOGUE_PREFIX}/TOTAL-catalogue-2026-2027-ua.pdf`;
const INDEX_KEY = `${CATALOGUE_PREFIX}/index.json`;
const CONCURRENCY = 10;
const PART_SIZE = 64 * 1024 * 1024;
const CACHE = "public, max-age=31536000, immutable";

const [dir, pdfPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const force = process.argv.includes("--force");
if (!dir || !pdfPath) {
  console.error("використання: upload-total-catalogue.mjs <тека-розбору> <каталог.pdf> [--force]");
  process.exit(1);
}

const BUCKET = process.env.R2_BUCKET_NAME;
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

async function exists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (e) {
    if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

async function put(key, body, contentType, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      await r2.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: CACHE }));
      return;
    } catch (e) {
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function uploadPdfMultipart(file, key) {
  const size = fs.statSync(file).size;
  const { UploadId } = await r2.send(new CreateMultipartUploadCommand({
    Bucket: BUCKET, Key: key, ContentType: "application/pdf", CacheControl: CACHE,
  }));
  const fd = fs.openSync(file, "r");
  const parts = [];
  try {
    for (let offset = 0, n = 1; offset < size; offset += PART_SIZE, n++) {
      const len = Math.min(PART_SIZE, size - offset);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      let etag;
      for (let attempt = 1; ; attempt++) {
        try {
          ({ ETag: etag } = await r2.send(new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId, PartNumber: n, Body: buf })));
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
          console.warn(`  частина ${n}: ${e.message}, повтор`);
        }
      }
      parts.push({ PartNumber: n, ETag: etag });
      console.log(`  PDF: ${Math.round(((offset + len) / size) * 100)}%`);
    }
    await r2.send(new CompleteMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId, MultipartUpload: { Parts: parts } }));
  } catch (e) {
    await r2.send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId })).catch(() => {});
    throw e;
  } finally {
    fs.closeSync(fd);
  }
}

const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
console.log(`каталог: ${index.items.length} позицій, ${index.pages} сторінок`);

// 1. Фото — паралельно, з пропуском наявних.
const queue = index.items.filter((it) => it.image);
let done = 0, skipped = 0;
const failures = [];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (;;) {
    const it = queue.shift();
    if (!it) return;
    const key = `${CATALOGUE_PREFIX}/images/${it.image}`;
    try {
      if (!force && (await exists(key))) { skipped++; continue; }
      await put(key, fs.readFileSync(path.join(dir, "images", it.image)), "image/jpeg");
      done++;
      if (done % 100 === 0) console.log(`  фото: ${done} завантажено, ${skipped} вже було`);
    } catch (e) {
      failures.push({ sku: it.sku, error: e.message });
    }
  }
}));
console.log(`фото: ${done} завантажено, ${skipped} вже було, ${failures.length} помилок`);
if (failures.length) console.log(failures.slice(0, 10));

// 2. Індекс — завжди перезаписуємо: він маленький, а розбір міг уточнитись.
await put(INDEX_KEY, Buffer.from(JSON.stringify(index), "utf8"), "application/json; charset=utf-8");
console.log(`індекс: ${INDEX_KEY}`);

// 3. PDF.
if (!force && (await exists(PDF_KEY))) {
  console.log(`PDF уже в бакеті: ${PDF_KEY}`);
} else {
  console.log(`PDF: ${(fs.statSync(pdfPath).size / 1e6).toFixed(0)} МБ → ${PDF_KEY}`);
  await uploadPdfMultipart(pdfPath, PDF_KEY);
  console.log("PDF завантажено");
}

console.log(`\nПублічно: ${process.env.R2_PUBLIC_URL}/${INDEX_KEY}`);
if (failures.length) process.exit(1);
