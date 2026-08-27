/**
 * Переносить фото товарів із чужих хостів у наш R2.
 *
 * Причина — 502 на /_next/image. Оптимізатор Next не віддає картинку сам:
 * він іде за нею на вказаний хост зі своєї функції. Поки хост живий, це
 * просто зайвий стрибок; коли він падає, кожен показ картки перетворюється
 * на невдалий виклик функції (502 не кешується, тож повторюється щоразу).
 * Саме це сталося з budsnabzbut.ua — домен перестав існувати, а посилання
 * на його фото лишилось у картці товару з 3 277 шт. на складі.
 *
 * Є й тихіші випадки: sigma.ua закриває гарячі посилання, і з IP Vercel те
 * саме фото віддається як 400, хоча з нашої машини завантажується. Тобто
 * частина «чужих» фото на сайті не показувалась узагалі — просто мовчки.
 *
 * Тому фото копіюємо до себе (products/<id>.<ext> у R2, як усі інші 27,5 тис.),
 * а те, чого вже не існує, чесно обнуляємо: картка покаже заглушку NoPhoto з
 * назвою бренда замість битого зображення. Після цього в next.config.ts
 * лишається білий список хостів — оптимізатор перестає бути відкритим
 * проксі в інтернет.
 *
 * Запуск: npx tsx --env-file=.env scripts/mirror-foreign-images.mts [--apply]
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import { uploadFile } from "../src/lib/r2";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

/** Хости, з яких фото віддаємо самі — їх переносити нікуди не треба. */
const OWN_HOSTS = ["files.budvik27.com", "www.budvik27.com", "budvik27.com"];

/**
 * Заголовки «як у браузера». Частина магазинів віддає фото лише при
 * правдоподібному User-Agent — без нього повертають 403 і порожнє тіло.
 */
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
};

/**
 * Посилання, які взагалі не є фото товару. Переносити їх до себе не можна:
 * заглушка чужого магазину на нашому CDN виглядатиме як наше фото і вже не
 * відрізниться від справжнього. Знімаємо — картка покаже NoPhoto з брендом.
 */
const NOT_A_PHOTO: Record<string, string> = {
  "https://torg-optom.com.ua/image/catalog/Logo-(1).png": "логотип чужого магазину",
  "https://prom.ua/cloud-cgi/static/catalog-ui/js/build/portal-portable/base_prom-73454d38.jpg":
    "елемент інтерфейсу Prom, а не товар",
};

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/pjpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const products = await prisma.product.findMany({
  where: { image: { not: null } },
  select: { id: true, sku: true, name: true, image: true, stock: true, isActive: true },
});

const foreign = products
  .filter((p) => {
    const host = hostOf(p.image!);
    return host !== null && !OWN_HOSTS.includes(host);
  })
  .sort((a, b) => b.stock - a.stock);

console.log(`фото на чужих хостах: ${foreign.length} із ${products.length}`);
if (foreign.length === 0) {
  await prisma.$disconnect();
  process.exit(0);
}

type Result = { id: string; sku: string | null; from: string; to: string | null; note: string };
const results: Result[] = [];

for (const p of foreign) {
  const from = p.image!;
  const mark = `${(p.sku ?? "—").padEnd(14)} зал ${String(p.stock).padStart(5)}  ${hostOf(from)}`;

  const junk = NOT_A_PHOTO[from];
  if (junk) {
    console.log(`  ✗ ${mark} — ${junk}, фото буде знято`);
    results.push({ id: p.id, sku: p.sku, from, to: null, note: junk });
    continue;
  }

  const got = await fetchImage(from);
  if (!got) {
    console.log(`  ✗ ${mark} — недоступне, фото буде знято`);
    results.push({ id: p.id, sku: p.sku, from, to: null, note: "джерело недоступне" });
    continue;
  }

  const key = `products/${p.id}.${EXT[got.type] ?? "jpg"}`;
  if (!apply) {
    console.log(`  · ${mark} → ${key} (${Math.round(got.bytes.length / 1024)} КБ)`);
    results.push({ id: p.id, sku: p.sku, from, to: `pending:${key}`, note: "перегляд" });
    continue;
  }

  const url = await uploadFile(got.bytes, key, got.type);
  console.log(`  ✓ ${mark} → ${url} (${Math.round(got.bytes.length / 1024)} КБ)`);
  results.push({ id: p.id, sku: p.sku, from, to: url, note: "перенесено" });
}

const moved = results.filter((r) => r.to && !r.to.startsWith("pending:"));
const dropped = results.filter((r) => r.to === null);

console.log(
  `\nпідсумок: перенести ${results.length - dropped.length}, зняти фото ${dropped.length}`
);

if (!apply) {
  console.log("\nРежим перегляду. Щоб записати: --apply");
  await prisma.$disconnect();
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 10);
const backup = `scripts/backup-foreign-images-${stamp}.json`;
fs.writeFileSync(backup, JSON.stringify(results, null, 1));

for (const r of moved) {
  await prisma.product.update({ where: { id: r.id }, data: { image: r.to } });
}
if (dropped.length > 0) {
  await prisma.product.updateMany({
    where: { id: { in: dropped.map((r) => r.id) } },
    data: { image: null },
  });
}

console.log(`\nперенесено: ${moved.length}; знято: ${dropped.length}; бекап: ${backup}`);
await prisma.$disconnect();

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function fetchImage(url: string): Promise<{ bytes: Buffer; type: string } | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;

    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!type.startsWith("image/")) return null;

    const bytes = Buffer.from(await res.arrayBuffer());
    // Заглушка «фото немає» у більшості магазинів важить менше кілобайта —
    // переносити її до себе означало б закріпити чужий брак.
    if (bytes.length < 1024) return null;

    return { bytes, type };
  } catch {
    return null;
  }
}
