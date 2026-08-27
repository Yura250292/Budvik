/**
 * Фото і характеристики «12 Atelie» з офіційного каталогу постачальника.
 *
 * Зіставляє артикули каталогу (index.json з R2) з товарами в базі і ставить
 * `Product.image` тим, у кого фото немає. Товари НЕ створює і ціни НЕ чіпає:
 * асортимент і ціни приходять з 1С (рішення власника від 18.08.2026).
 * Артикули каталогу, яких у базі нема, лягають у звіт як «майбутні» — коли
 * 1С їх заведе, повторний запуск підхопить фото сам. Сьогодні це 48 позицій,
 * майже всі — щітки склоочисника (952xxx), лінійка ще не в обліку.
 *
 * Бренд у базі роздвоєний: «Atelie» (slug atelie) і «12 ATELIE» (12-atelie),
 * та сама продукція з тими самими артикулами 951xxx — той самий випадок, що
 * й «Grösser» з двома формами «ö». Тому шукаємо по ОБОХ брендах; злиття
 * довідника — окрема робота (scripts/merge-brand-duplicates.mts). Поза цими
 * двома брендами не шукаємо: «951601» сам по собі може бути артикулом і
 * чужого постачальника, а чуже фото гірше за відсутнє.
 *
 * З `--descriptions` дописує в кінець опису секцію «Характеристики:» з
 * пунктів каталогу («• Армована структура»). Формат — той самий, який
 * розбирає splitDescription (src/lib/catalog/description-sections.ts) і
 * показує карткою під фото, тож UI чіпати не треба. Проза опису лишається
 * недоторканою, а повторний запуск замінює лише свою секцію.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/atelie-catalog/sync.mts                  # звіт, без змін
 *   npx tsx --env-file=.env scripts/atelie-catalog/sync.mts --apply
 *   --descriptions      ще й дописати «Характеристики:» з пунктів каталогу
 *   --index <url|файл>  інший індекс (типово — catalogs/atelie/latest.json)
 *   --force             замінити і наявні фото (типово ставимо лише порожнім)
 *   --include-inactive  ставити фото й вимкненим карткам
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const DESCRIPTIONS = args.includes("--descriptions");
const WITH_INACTIVE = args.includes("--include-inactive");
const indexArg = args.includes("--index") ? args[args.indexOf("--index") + 1] : null;
const HEADING = "Характеристики:";

type Row = {
  article: string;
  page: number;
  group: string;
  section: string;
  title: string;
  variant: string;
  bullets: string[];
  note: string;
  photoUrl: string | null;
};
type Index = { catalogYear: string; pdfUrl: string | null; rows: Row[] };

async function loadIndex(): Promise<Index> {
  let src = indexArg;
  if (!src) {
    const latest = await fetch(`${process.env.R2_PUBLIC_URL}/catalogs/atelie/latest.json`);
    if (!latest.ok) throw new Error(`latest.json: HTTP ${latest.status} — спершу publish.mts`);
    src = ((await latest.json()) as { indexUrl: string }).indexUrl;
  }
  if (/^https?:/.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    return (await res.json()) as Index;
  }
  return JSON.parse(fs.readFileSync(src, "utf8")) as Index;
}

/** Прибрати НАШУ стару секцію характеристик — щоб повторний запуск не двоїв. */
function stripSection(description: string): string {
  const lines = description.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase() !== HEADING.toLowerCase()) {
      out.push(lines[i]);
      continue;
    }
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if (!/^\s*[•·‣▪–—-]\s+/.test(lines[j])) break;
    }
    i = j - 1;
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function withSection(description: string, bullets: string[]): string {
  const section = [HEADING, ...bullets.map((b) => `• ${b}`)].join("\n");
  const base = stripSection(description ?? "");
  return base ? `${base}\n\n${section}` : section;
}

const index = await loadIndex();
const byArticle = new Map(index.rows.map((r) => [r.article.trim(), r]));

const brands = await prisma.brand.findMany({
  where: { slug: { in: ["atelie", "12-atelie"] } },
  select: { id: true, name: true },
});
if (!brands.length) throw new Error("Бренди Atelie / 12 ATELIE не знайдено");
const products = await prisma.product.findMany({
  where: { brandId: { in: brands.map((b) => b.id) } },
  select: { id: true, sku: true, name: true, image: true, isActive: true, stock: true, description: true },
});

type Hit = { product: (typeof products)[number]; row: Row };
const matched: Hit[] = [];
for (const p of products) {
  const row = byArticle.get((p.sku ?? "").trim());
  if (row) matched.push({ product: p, row });
}

/**
 * Наше фото — те, що ми самі поставили з цього каталогу. Його оновлюємо без
 * питань: після повторного розбору PDF файл може називатись інакше. Чужі
 * фото (`/products/…` зі старого сайту) не чіпаємо — вони зняті окремо на
 * кожен варіант і зазвичай кращі за каталожні.
 */
const isOurs = (url: string | null) => !!url && url.includes("/catalogs/atelie/");

const eligible = matched.filter((m) => WITH_INACTIVE || m.product.isActive);
const toSet = eligible.filter(
  (m) => m.row.photoUrl && m.row.photoUrl !== m.product.image && (FORCE || !m.product.image || isOurs(m.product.image))
);
const hasImage = eligible.filter((m) => m.product.image && !isOurs(m.product.image) && !FORCE);
/** Характеристики дописуємо там, де в каталозі є щонайменше два пункти. */
const toDescribe = eligible.filter((m) => m.row.bullets.length >= 2).filter((m) => {
  const next = withSection(m.product.description ?? "", m.row.bullets);
  return next !== (m.product.description ?? "");
});
const matchedArticles = new Set(matched.map((m) => m.row.article));
const future = index.rows.filter((r) => !matchedArticles.has(r.article));
const matchedIds = new Set(matched.map((m) => m.product.id));
const orphans = products.filter((p) => p.isActive && !matchedIds.has(p.id));

console.log(`Каталог ${index.catalogYear}: ${index.rows.length} артикулів`);
console.log(`Товарів у базі (Atelie + 12 ATELIE): ${products.length} (активних ${products.filter((p) => p.isActive).length})`);
console.log(`Збіглося за артикулом: ${matched.length} (активних ${matched.filter((m) => m.product.isActive).length})`);
console.log(`  поставити фото: ${toSet.length}`);
console.log(`  фото вже є (пропуск, --force замінить): ${hasImage.length}`);
console.log(`  дописати «Характеристики:»: ${toDescribe.length}${DESCRIPTIONS ? "" : "  (увімкнути: --descriptions)"}`);
console.log(`Артикулів каталогу без товару в базі («майбутні»): ${future.length}`);
console.log(`Активних товарів поза каталогом: ${orphans.length} (з них із залишком ${orphans.filter((p) => p.stock > 0).length})`);

console.log("\n── Поставимо фото (перші 40) ──");
for (const m of toSet.slice(0, 40)) {
  console.log(`  ${(m.product.sku ?? "—").padEnd(10)} стор.${String(m.row.page).padEnd(3)} ${m.product.name.slice(0, 66)}`);
}
console.log("\n── Майбутні (в каталозі є, в базі нема) ──");
for (const r of future) console.log(`  ${r.article.padEnd(10)} стор.${String(r.page).padEnd(3)} ${(r.title || r.section).slice(0, 60)}`);

const stamp = new Date().toISOString().slice(0, 10);
const report = {
  catalogYear: index.catalogYear,
  at: new Date().toISOString(),
  apply: APPLY,
  descriptions: DESCRIPTIONS,
  set: toSet.map((m) => ({
    productId: m.product.id,
    sku: m.product.sku,
    name: m.product.name,
    article: m.row.article,
    page: m.row.page,
    oldImage: m.product.image,
    newImage: m.row.photoUrl,
  })),
  described: toDescribe.map((m) => ({
    productId: m.product.id,
    sku: m.product.sku,
    bullets: m.row.bullets,
    oldDescription: m.product.description,
  })),
  future: future.map((r) => ({ article: r.article, page: r.page, title: r.title, section: r.section, photoUrl: r.photoUrl })),
  orphans: orphans.map((p) => ({ productId: p.id, sku: p.sku, name: p.name, stock: p.stock })),
};
fs.mkdirSync("output/atelie-catalog", { recursive: true });
const reportPath = `output/atelie-catalog/sync-${stamp}${APPLY ? "-applied" : "-dry"}.json`;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(`\nЗвіт: ${reportPath}`);

if (APPLY) {
  let photos = 0;
  for (const m of toSet) {
    await prisma.product.update({ where: { id: m.product.id }, data: { image: m.row.photoUrl } });
    photos++;
  }
  console.log(`Оновлено фото: ${photos}`);
  if (DESCRIPTIONS) {
    let described = 0;
    for (const m of toDescribe) {
      await prisma.product.update({
        where: { id: m.product.id },
        data: { description: withSection(m.product.description ?? "", m.row.bullets) },
      });
      described++;
    }
    console.log(`Дописано характеристик: ${described}`);
  }
} else if (toSet.length || toDescribe.length) {
  console.log("Сухий прогін. Щоб застосувати: --apply [--descriptions]");
}
// Вітрина кешується (ISR) — без цього фото з'являться лише за годину.
if (APPLY) {
  const base = process.env.NEXTAUTH_URL;
  const agent = process.env.SYNC_AGENT_ID;
  const secret = process.env.SYNC_AGENT_SECRET;
  if (base && agent && secret) {
    const body = "{}";
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
    const res = await fetch(`${base}/api/sync-ingest/revalidate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-agent": agent, "x-sync-timestamp": ts, "x-sync-signature": sig },
      body,
    });
    console.log(`Кеш вітрини: ${res.status} ${await res.text()}`);
  } else {
    console.log("Кеш вітрини: немає SYNC_AGENT_*/NEXTAUTH_URL — оновиться сам за годину");
  }
}

await prisma.$disconnect();
