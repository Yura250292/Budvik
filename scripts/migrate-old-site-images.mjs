/**
 * Перенесення фото товарів зі старого сайту budvik.com у власний R2.
 *
 * Навіщо: 26 тис. карток нового сайту вантажать фото прямо зі старого
 * домену. Перед 301-редіректом budvik.com → budvik27.com ці посилання
 * зламаються, тому спершу фото переїжджають у files.budvik27.com.
 *
 * Скрипт безпечний до перезапуску: бере лише товари, чиє фото досі на
 * budvik.com, і оновлює запис одразу після успішного завантаження. Перед
 * стартом пише повний бекап відповідності id → старий URL.
 *
 * Запуск: node --env-file=.env scripts/migrate-old-site-images.mjs
 */
import { PrismaClient } from "@prisma/client";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs";

const prisma = new PrismaClient();
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;
const CONCURRENCY = 10;

const EXT_BY_TYPE = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

async function downloadWithRetry(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = (res.headers.get("content-type") || "").split(";")[0].trim();
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) throw new Error(`too small: ${buf.length}b`);
      return { buf, type };
    } catch (e) {
      if (i === tries) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

const products = await prisma.product.findMany({
  where: { image: { startsWith: "https://budvik.com" } },
  select: { id: true, image: true },
  orderBy: { id: "asc" },
});
console.log(`До перенесення: ${products.length} фото`);

const backupPath = `scripts/backup-budvik-com-images-${new Date().toISOString().slice(0, 10)}.json`;
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, JSON.stringify(products, null, 1));
  console.log(`Бекап посилань: ${backupPath}`);
}

let done = 0;
let failed = 0;
const failures = [];
const queue = [...products];

async function worker() {
  for (;;) {
    const p = queue.shift();
    if (!p) return;
    try {
      const { buf, type } = await downloadWithRetry(p.image);
      if (!type.startsWith("image/")) throw new Error(`not an image: ${type}`);
      const ext = EXT_BY_TYPE[type] || ".jpg";
      const key = `products/${p.id}${ext}`;
      await r2.send(
        new PutObjectCommand({
          Bucket: BUCKET,
          Key: key,
          Body: buf,
          ContentType: type,
          CacheControl: "public, max-age=31536000, immutable",
        })
      );
      await prisma.product.update({
        where: { id: p.id },
        data: { image: `${PUBLIC_URL}/${key}` },
      });
      done++;
    } catch (e) {
      failed++;
      failures.push({ id: p.id, image: p.image, error: String(e.message || e) });
    }
    if ((done + failed) % 500 === 0) {
      console.log(`${done + failed}/${products.length} (ok ${done}, помилок ${failed})`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\nГотово: перенесено ${done}, помилок ${failed}`);
if (failures.length) {
  const failPath = "scripts/migrate-images-failures.json";
  fs.writeFileSync(failPath, JSON.stringify(failures, null, 1));
  console.log(`Список помилок: ${failPath} (перші 5 нижче)`);
  console.log(failures.slice(0, 5));
}
await prisma.$disconnect();
