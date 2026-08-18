/**
 * Прев'ю з cdn.27.ua → повний розмір.
 *
 * У шляху cdn.27.ua перший сегмент — це ширина: /190/ це 190×190, і саме
 * такі файли картка розтягує на 780px, звідки й розмитість. Той самий файл
 * лежить під /1200/ — інша адреса, та сама картинка.
 *
 * Наосліп не міняємо: перед записом стукаємо по великому варіанту й беремо
 * лише те, що реально віддається. Старі адреси лягають у backup-файл —
 * відкат це один UPDATE зі збереженого.
 *
 *   node scripts/upgrade-27ua-image-size.mjs           проба, нічого не пише
 *   node scripts/upgrade-27ua-image-size.mjs --apply   запис
 */
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";

const APPLY = process.argv.includes("--apply");
const TARGET = "1200";
const CONCURRENCY = 12;

const prisma = new PrismaClient();

/** Прев'ю: /190/…, /799/… — але не /sc--media--prod/ і не вже-цільове. */
function biggerUrl(image) {
  const m = image.match(/^https:\/\/cdn\.27\.ua\/(\d+)\/(.+)$/);
  if (!m) return null;
  const [, size, rest] = m;
  if (Number(size) >= Number(TARGET)) return null;
  return `https://cdn.27.ua/${TARGET}/${rest}`;
}

async function exists(url) {
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-0", "User-Agent": "Mozilla/5.0 (compatible; BudvikBot/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    return res.status < 400;
  } catch {
    return false;
  }
}

async function main() {
  const products = await prisma.product.findMany({
    where: { image: { startsWith: "https://cdn.27.ua/" } },
    select: { id: true, sku: true, name: true, image: true, stock: true },
  });

  const candidates = [];
  for (const p of products) {
    const url = biggerUrl(p.image);
    if (url) candidates.push({ ...p, newImage: url });
  }
  console.log(
    `фото з cdn.27.ua: ${products.length}, з них прев'ю: ${candidates.length} ` +
      `(в наявності: ${candidates.filter((c) => c.stock > 0).length})`
  );

  const ok = [];
  const missing = [];
  let done = 0;
  const queue = [...candidates];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        (await exists(item.newImage) ? ok : missing).push(item);
        if (++done % 100 === 0) console.log(`  перевірено ${done}/${candidates.length}`);
      }
    })
  );
  console.log(`великий варіант є: ${ok.length}, немає: ${missing.length}`);
  for (const m of missing.slice(0, 10)) console.log(`  пропуск: ${m.sku} ${m.image}`);

  if (!APPLY) {
    console.log("\nпроба — нічого не записано. --apply щоб застосувати");
    for (const s of ok.slice(0, 3)) console.log(`  ${s.image}\n→ ${s.newImage}`);
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const backup = `scripts/backup-27ua-images-${stamp}.json`;
  writeFileSync(backup, JSON.stringify(ok.map((o) => ({ id: o.id, image: o.image })), null, 2));
  console.log(`старі адреси збережено: ${backup}`);

  let updated = 0;
  for (let i = 0; i < ok.length; i += 200) {
    const chunk = ok.slice(i, i + 200);
    await prisma.$transaction(
      chunk.map((c) => prisma.product.update({ where: { id: c.id }, data: { image: c.newImage } }))
    );
    updated += chunk.length;
    console.log(`  оновлено ${updated}/${ok.length}`);
  }
  console.log(`готово: ${updated} фото у повному розмірі`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
