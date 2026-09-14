/**
 * Перерахунок цін вітрини рушієм — усього каталогу або бренду.
 *
 * Звичайно рушій працює сам: після обміну з 1С, після нічної переперевірки
 * ринку і після зміни правила в адмінці. Скрипт потрібен для масових змін —
 * першого запуску цінового шару, нового джерела ринкових цін, — щоб спершу
 * побачити, що зміниться, і лише потім записати.
 *
 *   npx tsx --env-file=.env scripts/pricing/reprice.mts                 # проба: що зміниться
 *   npx tsx --env-file=.env scripts/pricing/reprice.mts --apply         # бекап, запис, скидання кешу вітрини
 *   --brand <slug>   лише один бренд
 *   --backfill       разово заповнити Price1C з полів товару (до першого нічного
 *                    зрізу 1С). Вітрину не змінює, тож пишеться і без --apply.
 *
 * Відкат: output/reprice-backup-<час>.json — стара ціна кожного зміненого товару.
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { BASIS_LABELS, repriceProducts, type RepriceChange } from "../../src/lib/pricing/engine";
import { signPayload, SYNC_HEADERS } from "../../src/lib/sync-ingest/auth";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const BACKFILL = args.includes("--backfill");
const brandSlug = args.includes("--brand") ? args[args.indexOf("--brand") + 1] : null;

if (BACKFILL) {
  // Опт — з копії в товарі, але лише там, де зріз цін 1С товар хоч раз
  // підтверджував (priceSyncedAt): у полі лежать і залишки старого імпорту —
  // 31 товар з «Імпорт з 1С», яких 1С у зрізі цін не віддавала ніколи, серед
  // них планшети для ТО і рекламний стенд. Поверх наявного рядка опт
  // оновлюємо: між заповненням і деплоєм нового обміну старий міг змінити
  // ціну лише в товарі.
  // Роздріб — лише де ціна не розрахована і зріз 1С її підтверджував: інакше
  // в сирий шар потрапила б наша ж оцінка або ціна старого імпорту. Нічний
  // повний зріз однаково перепише обидва типи тим, що скаже 1С.
  const w = await prisma.$executeRaw`
    INSERT INTO "Price1C" ("productId", kind, price, "changedAt")
    SELECT id, 'WHOLESALE', "wholesalePrice", now() FROM "Product"
    WHERE "externalId" IS NOT NULL AND "wholesalePrice" > 0 AND "priceSyncedAt" IS NOT NULL
    ON CONFLICT ("productId", kind) DO UPDATE SET price = EXCLUDED.price, "changedAt" = now()
    WHERE abs("Price1C".price - EXCLUDED.price) > 0.01`;
  const r = await prisma.$executeRaw`
    INSERT INTO "Price1C" ("productId", kind, price, "changedAt")
    SELECT id, 'RETAIL', price, now() FROM "Product"
    WHERE "externalId" IS NOT NULL AND price > 0 AND NOT "priceDerived" AND "priceSyncedAt" IS NOT NULL
    ON CONFLICT ("productId", kind) DO NOTHING`;
  console.log(`Price1C заповнено: опт ${w}, роздріб ${r}`);
}

let scope: { brandId: string } | { all: true } = { all: true };
if (brandSlug) {
  const brand = await prisma.brand.findUnique({ where: { slug: brandSlug }, select: { id: true } });
  if (!brand) throw new Error(`бренд ${brandSlug} не знайдено`);
  scope = { brandId: brand.id };
}

const preview = await repriceProducts(scope, { preview: true });

const ids = preview.changes.map((c) => c.productId);
const stock = new Map<string, number>();
for (let i = 0; i < ids.length; i += 5000) {
  for (const p of await prisma.product.findMany({ where: { id: { in: ids.slice(i, i + 5000) } }, select: { id: true, stock: true } })) {
    stock.set(p.id, p.stock);
  }
}
const brandNames = new Map((await prisma.brand.findMany({ select: { id: true, name: true } })).map((b) => [b.id, b.name]));

console.log(`\nТоварів з цінами 1С: ${preview.evaluated}`);
console.log("Походження ціни:");
for (const [basis, n] of Object.entries(preview.byBasis)) console.log(`   ${String(n).padStart(6)}  ${BASIS_LABELS[basis as keyof typeof BASIS_LABELS]}`);
console.log("Позначки:", preview.byFlag);

const shown = preview.changes.filter((c) => (stock.get(c.productId) ?? 0) > 0);
const pct = (c: RepriceChange) => (c.newPrice - c.oldPrice) / c.oldPrice;
console.log(`\nЗміниться цін: ${preview.priceChanged}, з них у наявності ${shown.length} (дорожче ${shown.filter((c) => c.newPrice > c.oldPrice).length}, дешевше ${shown.filter((c) => c.newPrice < c.oldPrice).length})`);

const byBrand = new Map<string, RepriceChange[]>();
for (const c of shown) {
  const name = (c.brandId && brandNames.get(c.brandId)) || "(без бренду)";
  byBrand.set(name, [...(byBrand.get(name) ?? []), c]);
}
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
console.log("\nУ наявності по брендах (змін / дорожче / дешевше / медіана зміни):");
for (const [name, list] of [...byBrand].sort((a, b) => b[1].length - a[1].length).slice(0, 20)) {
  const up = list.filter((c) => c.newPrice > c.oldPrice).length;
  console.log(`   ${name.padEnd(16)} ${String(list.length).padStart(5)} ${String(up).padStart(5)} ${String(list.length - up).padStart(5)}   ${(med(list.map(pct)) * 100).toFixed(1)} %`);
}
console.log("\nНайбільші зміни в наявності:");
for (const c of [...shown].sort((a, b) => Math.abs(pct(b)) - Math.abs(pct(a))).slice(0, 12)) {
  console.log(`   ${(c.sku ?? "").padEnd(14)} ${c.name.slice(0, 50).padEnd(50)} ${c.oldPrice} → ${c.newPrice} (${BASIS_LABELS[c.basis]}, опт ${c.wholesale}${c.market ? `, ринок ${c.market}` : ""})`);
}

if (!APPLY) {
  console.log("\nПроба — нічого не записано. Записати: --apply");
  await prisma.$disconnect();
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const backup = `output/reprice-backup-${stamp}.json`;
fs.writeFileSync(backup, JSON.stringify(preview.changes.map((c) => ({ productId: c.productId, sku: c.sku, oldPrice: c.oldPrice, newPrice: c.newPrice })), null, 1));
console.log(`\nБекап старих цін: ${backup}`);

const applied = await repriceProducts(scope);
console.log(`Записано: SitePrice ${applied.siteRowsWritten}, змінено цін ${applied.priceChanged}`);

const agent = process.env.SYNC_AGENT_ID;
const secret = process.env.SYNC_AGENT_SECRET;
if (applied.priceChanged > 0 && agent && secret) {
  const url = process.env.SITE_REVALIDATE_URL ?? "https://www.budvik27.com/api/sync-ingest/revalidate";
  const rawBody = JSON.stringify({ scope: "storefront" });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SYNC_HEADERS.agent]: agent,
      [SYNC_HEADERS.timestamp]: timestamp,
      [SYNC_HEADERS.signature]: signPayload(secret, timestamp, rawBody),
    },
    body: rawBody,
  }).catch((e: Error) => ({ ok: false, status: e.message }) as const);
  console.log(`Кеш вітрини: ${res.ok ? "скинуто" : `не скинуто (${res.status}) — оновиться сам протягом години`}`);
}
await prisma.$disconnect();
