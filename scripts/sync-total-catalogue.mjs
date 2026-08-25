/**
 * Синхронізація карток TOTAL з офіційним каталогом постачальника.
 *
 * Джерело — індекс, який лежить у R2 (див. scripts/upload-total-catalogue.mjs):
 * артикул, назва, рядки характеристик, пакування, фото. Товари в базі шукаємо
 * за артикулом, бо назви в 1С свої («TOTAL Роторна фреза тип F») і збігатися
 * з каталогом не зобов'язані. Артикул у 1С інколи має хвіст «-f9e4b1» — так
 * позначені дублі номенклатури; хвіст відкидаємо, і дубль отримує те саме
 * фото, що й оригінал.
 *
 * Що пишемо в картку:
 *   image        — фото з каталогу, якщо фото немає або воно з cdn.27.ua
 *                  (водяний знак Епіцентру). Своє завантажене не чіпаємо,
 *                  хіба з --force-images.
 *   description  — до наявного опису дописуємо «Характеристики:» і
 *                  «Комплектація:» у форматі, який розбирає
 *                  src/lib/catalog/description-sections.ts. Якщо секція
 *                  «Характеристики:» уже є — опис не чіпаємо.
 *   brandId      — товар з артикулом із каталогу й «TOTAL» у назві, але
 *                  іншим брендом (рулетки «Standart» причепились до StandART),
 *                  повертаємо до TOTAL.
 * Назву, ціну, packQty не чіпаємо: назва й ціна — з 1С; «кількість у малій
 * коробці» — це заводське пакування, а не крок замовлення (див. lib/pack-qty.ts).
 *
 * Без --apply нічого не пише — лише звіт. Перед записом — бекап старих значень
 * у scripts/backup-total-catalogue-<дата>.json. Після запису скидає кеш
 * вітрини через /api/sync-ingest/revalidate (той самий HMAC, що в агента 1С).
 *
 * Запуск: node --env-file=.env scripts/sync-total-catalogue.mjs [--apply] [--force-images] [--index <шлях>] [--show SKU,SKU]
 *   --show — надрукувати запланований опис для вказаних артикулів.
 */
import { PrismaClient } from "@prisma/client";
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import fs from "node:fs";

const CATALOGUE_PREFIX = "catalogues/total/2026";
const BRAND_SLUG = "total";
const WATERMARKED_HOSTS = ["cdn.27.ua"];
const UNIT_WORD = { PCS: "шт.", SET: "наб.", PAIR: "пар" };

const apply = process.argv.includes("--apply");
const forceImages = process.argv.includes("--force-images");
const indexArg = process.argv.indexOf("--index");
const localIndex = indexArg > -1 ? process.argv[indexArg + 1] : null;
const showArg = process.argv.indexOf("--show");
const showSkus = showArg > -1 ? process.argv[showArg + 1].split(",").map((s) => s.trim().toLowerCase()) : [];

const prisma = new PrismaClient();
const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

async function loadIndex() {
  if (localIndex) return JSON.parse(fs.readFileSync(localIndex, "utf8"));
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: `${CATALOGUE_PREFIX}/index.json` }));
  return JSON.parse(await res.Body.transformToString());
}

async function imageExists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (e) {
    if (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) return false;
    throw e;
  }
}

const normSku = (s) => (s || "").trim().toLowerCase();
/** «TAKMG4208-30f3af» → «takmg4208»: хвіст із 6 hex-символів ставить синхронізація 1С дублям. */
const baseSku = (s) => normSku(s).replace(/-[0-9a-f]{6}$/, "");

const KIT_HEADING = /^(в комплекті|включає|комплект(ація)?|в наборі|набір включає|до комплекту входить)\s*:?$/i;
const KEY_VALUE = /^([^:]{1,40}):\s*(.+)$/;
/** «40 шт. Шліфувальні циліндри» — пункт комплектації, навіть якщо заголовка «В комплекті:» немає. */
const QTY_ITEM = /^\d+\s*шт\.?\s+\S/i;

/** Ключі, які в каталозі уточнюють попередній пункт комплектації, а не виріб загалом. */
const SUB_KEYS = new Set(["діаметр", "розмір", "розміри", "довжина", "крок", "матеріал полотна"]);

/**
 * Рядки каталогу → секції «Характеристики:» / «Комплектація:».
 *
 * Комплектація в каталозі — це або заголовок «В комплекті:» з пунктами
 * «6 шт. …», або самі пункти без заголовка. Після пунктів зазвичай ідуть
 * загальні властивості («Магнітний накінечник», «Матеріал: CrV») — тому з
 * режиму комплектації виходимо на першому рядку, що не пункт і не уточнення
 * до пункту («Діаметр: 2/3/4 мм» одразу після «6 шт. свердел по металу»).
 */
function buildSections(item) {
  const specs = [];
  const kit = [];
  let inKit = false;
  // «10,10 шт. Алмазна головка» — зверстана нумерація «10. 10 шт. …», номер відкидаємо.
  const lines = item.lines.map((l) => l.trim().replace(/^\d+,(\d+\s*шт)/, "$1")).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (KIT_HEADING.test(line)) { inKit = true; continue; }
    if (QTY_ITEM.test(line)) { kit.push(line); inKit = true; continue; }
    if (inKit) {
      if (/^[-–—]\s*\S/.test(line)) { kit.push(line.replace(/^[-–—]\s*/, "")); continue; }
      const kv = KEY_VALUE.exec(line);
      if (kv && kit.length && SUB_KEYS.has(kv[1].trim().toLowerCase())) {
        kit[kit.length - 1] += ` — ${kv[1].trim().toLowerCase()}: ${kv[2].trim()}`;
        continue;
      }
      inKit = false;
    }
    // «Розміри:» і на наступному рядку «8/10/12 мм» — один пункт, а не два.
    const next = lines[i + 1];
    if (line.endsWith(":") && next && !next.includes(":") && !QTY_ITEM.test(next)) {
      specs.push(`${line} ${next}`);
      i++;
      continue;
    }
    specs.push(line);
  }
  if (item.packSmall && item.packBig && !(item.packSmall === 1 && item.packBig === 1)) {
    const u = UNIT_WORD[item.unit] || "шт.";
    specs.push(`Кількість у коробці: ${item.packSmall} ${u} (мала), ${item.packBig} ${u} (велика)`);
  }
  return { specs, kit };
}

function buildDescription(existing, item) {
  const { specs, kit } = buildSections(item);
  const parts = [];
  const base = (existing || "").trim();
  if (base) parts.push(base);
  if (specs.length) parts.push(`Характеристики:\n${specs.map((s) => `• ${s}`).join("\n")}`);
  if (kit.length) parts.push(`Комплектація:\n${kit.map((s) => `• ${s}`).join("\n")}`);
  return parts.join("\n\n");
}

function imageHost(url) {
  try { return new URL(url).host; } catch { return null; }
}

async function bustStorefrontCache() {
  const base = process.env.NEXTAUTH_URL;
  const agent = process.env.SYNC_AGENT_ID;
  const secret = process.env.SYNC_AGENT_SECRET;
  if (!base || !agent || !secret) { console.log("кеш вітрини: немає SYNC_AGENT_*/NEXTAUTH_URL, оновиться сам за годину"); return; }
  const body = "{}";
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  const res = await fetch(`${base}/api/sync-ingest/revalidate`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-agent": agent, "x-sync-timestamp": ts, "x-sync-signature": sig },
    body,
  });
  console.log(`кеш вітрини: ${res.status} ${await res.text()}`);
}

const index = await loadIndex();
const bySku = new Map(index.items.map((it) => [normSku(it.sku), it]));
console.log(`каталог: ${bySku.size} позицій`);

const brand = await prisma.brand.findUnique({ where: { slug: BRAND_SLUG }, select: { id: true, name: true } });
if (!brand) throw new Error(`бренд «${BRAND_SLUG}» не знайдено`);

const products = await prisma.product.findMany({
  where: { OR: [{ brandId: brand.id }, { sku: { in: index.items.map((it) => it.sku), mode: "insensitive" } }] },
  select: { id: true, sku: true, name: true, image: true, description: true, brandId: true, stock: true, isActive: true, brand: { select: { name: true } } },
});

const plan = [];
const unmatched = [];
for (const p of products) {
  const item = bySku.get(normSku(p.sku)) ?? bySku.get(baseSku(p.sku));
  if (!item) { unmatched.push(p); continue; }
  const change = { id: p.id, sku: p.sku, name: p.name, item, data: {} };
  const host = imageHost(p.image);
  if (item.image && (forceImages || !p.image || WATERMARKED_HOSTS.includes(host))) {
    change.data.image = `${PUBLIC_URL}/${CATALOGUE_PREFIX}/images/${item.image}`;
  }
  if (!/^\s*Характеристики:/m.test(p.description || "")) {
    change.data.description = buildDescription(p.description, item);
  }
  if (p.brandId !== brand.id && /\btotal\b/i.test(p.name)) {
    change.data.brandId = brand.id;
    change.brandFrom = p.brand?.name ?? "—";
  }
  if (Object.keys(change.data).length) plan.push(change);
}

const matchedCount = products.length - unmatched.length;
const inDb = new Set(products.map((p) => baseSku(p.sku)));
const onlyInCatalogue = index.items.filter((it) => !inDb.has(normSku(it.sku)));

console.log(`товарів у базі (TOTAL або артикул з каталогу): ${products.length}`);
console.log(`  знайдено в каталозі: ${matchedCount}, без відповідника: ${unmatched.length}`);
console.log(`  зміни: фото ${plan.filter((c) => c.data.image).length}, опис ${plan.filter((c) => c.data.description).length}, бренд ${plan.filter((c) => c.data.brandId).length}`);
console.log(`позицій каталогу, яких у нас ще немає: ${onlyInCatalogue.length}`);
if (unmatched.length) {
  console.log("\nTOTAL без відповідника в каталозі (перші 15):");
  for (const p of unmatched.slice(0, 15)) console.log(`  ${p.sku}  ${p.name}  (залишок ${p.stock})`);
}
for (const c of plan.filter((x) => x.brandFrom)) console.log(`бренд: ${c.sku} ${c.brandFrom} → ${brand.name}  ${c.name}`);

// Приклади описів, щоб очима перевірити формат перед записом.
const samples = showSkus.length
  ? plan.filter((c) => showSkus.includes(normSku(c.sku)))
  : [plan.find((c) => c.data.description && c.item.lines.some((l) => KIT_HEADING.test(l))) ?? plan.find((c) => c.data.description)].filter(Boolean);
for (const c of samples) console.log(`\n--- ${c.sku} ${c.name}\n${c.data.description ?? "(опис не змінюється)"}\n---`);

if (!apply) {
  console.log("\nРежим перегляду. Щоб записати: --apply");
  await prisma.$disconnect();
  process.exit(0);
}

// Фото мають реально лежати в R2 — інакше картка покаже биту картинку.
const missing = [];
const withImage = plan.filter((c) => c.data.image);
await Promise.all(Array.from({ length: 10 }, async () => {
  for (;;) {
    const c = withImage.shift();
    if (!c) return;
    if (!(await imageExists(`${CATALOGUE_PREFIX}/images/${c.item.image}`))) { missing.push(c.sku); delete c.data.image; }
  }
}));
if (missing.length) console.log(`фото відсутні в R2 (пропущено): ${missing.length} ${missing.slice(0, 10)}`);

const stamp = new Date().toISOString().slice(0, 10);
const backupPath = `scripts/backup-total-catalogue-${stamp}.json`;
const before = new Map(products.map((p) => [p.id, p]));
fs.writeFileSync(backupPath, JSON.stringify(plan.map((c) => {
  const p = before.get(c.id);
  return { id: c.id, sku: c.sku, image: p.image, description: p.description, brandId: p.brandId };
}), null, 1));
console.log(`бекап: ${backupPath}`);

let written = 0;
for (let i = 0; i < plan.length; i += 50) {
  const batch = plan.slice(i, i + 50).filter((c) => Object.keys(c.data).length);
  await prisma.$transaction(batch.map((c) => prisma.product.update({ where: { id: c.id }, data: c.data })));
  written += batch.length;
}
console.log(`записано: ${written} карток`);

await prisma.$disconnect();
await bustStorefrontCache();
