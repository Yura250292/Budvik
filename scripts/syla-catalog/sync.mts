/**
 * Фото товарів СИЛА з офіційного каталогу постачальника.
 *
 * Зіставляє артикули каталогу (index.json з R2) з товарами в базі і ставить
 * `Product.image` тим, у кого фото немає. Товари НЕ створює і ціни НЕ чіпає:
 * асортимент і ціни приходять з 1С (рішення власника від 18.08.2026).
 * Артикули каталогу, яких у базі нема, лягають у звіт як «майбутні» — коли
 * 1С їх заведе, повторний запуск підхопить фото сам.
 *
 * Зіставлення точне: артикул каталогу дорівнює `sku` товару (шість цифр), і
 * шукаємо ЛИШЕ серед бренду СИЛА. Номер виду «300731» сам по собі буває
 * артикулом і в інших постачальників, а чуже фото гірше за відсутнє.
 *
 * Один знімок часто стоїть на цілу групу розмірів — так у самому каталозі
 * (шість довжин ломів під одним фото). Описи звідси не беремо: у каталозі
 * СИЛА проза не прив'язана до артикула, а лише до клітинки.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/syla-catalog/sync.mts                 # звіт, без змін
 *   npx tsx --env-file=.env scripts/syla-catalog/sync.mts --apply
 *   --index <url|файл>  інший індекс (типово — catalogs/syla/latest.json)
 *   --force             замінити і наявні фото (типово ставимо лише порожнім)
 *   --include-inactive  ставити фото й вимкненим карткам
 *   --ignore-name-check вимкнути звірку назв (див. nameAgrees нижче)
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const WITH_INACTIVE = args.includes("--include-inactive");
const SKIP_CHECK = args.includes("--ignore-name-check");
const indexArg = args.includes("--index") ? args[args.indexOf("--index") + 1] : null;

type Row = {
  article: string;
  page: number;
  group: string;
  title: string;
  variant: string;
  photoUrl: string | null;
};
type Index = { catalogYear: string; pdfUrl: string | null; rows: Row[] };

async function loadIndex(): Promise<Index> {
  let src = indexArg;
  if (!src) {
    const latest = await fetch(`${process.env.R2_PUBLIC_URL}/catalogs/syla/latest.json`);
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

const index = await loadIndex();
const byArticle = new Map(index.rows.map((r) => [r.article.trim(), r]));

const brand = await prisma.brand.findFirst({ where: { slug: "syla" }, select: { id: true } });
if (!brand) throw new Error("Бренд СИЛА не знайдено");
const products = await prisma.product.findMany({
  where: { brandId: brand.id },
  select: { id: true, sku: true, name: true, image: true, isActive: true, stock: true },
});

type Hit = { product: (typeof products)[number]; row: Row };
const matched: Hit[] = [];
for (const p of products) {
  const row = byArticle.get((p.sku ?? "").trim());
  if (row) matched.push({ product: p, row });
}

/** Наше фото — те, що ми самі поставили з цього каталогу; його оновлюємо. */
const isOurs = (url: string | null) => !!url && url.includes("/catalogs/syla/");

/**
 * Запобіжник від чужого фото.
 *
 * Зіставлення за артикулом точне, але фото до артикула прив'язує розбір
 * PDF за геометрією, і на складних розворотах він помиляється. Тому
 * звіряємо ще й назви: якщо жодне слово назви з каталогу не перегукується
 * з назвою товару в 1С — це не наш знімок. «Чуже фото гірше за відсутнє».
 *
 * Порівнюємо трилітерними коренями, бо форми різняться відмінком і числом
 * («КЛЮЧІ ТРУБНІ» проти «Ключ трубний», «РІВНІ» проти «Рівень»), а в базі
 * трапляється латинська «i» посеред кирилиці («Лiска для тримера»).
 */
const LOOKALIKE: Record<string, string> = { i: "і", a: "а", o: "о", e: "е", c: "с", p: "р", x: "х", y: "у", t: "т", k: "к", m: "м", h: "н", b: "в" };
const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/[iaoecpxytkmhb]/g, (c) => LOOKALIKE[c] ?? c)
    .replace(/[^а-яіїєґ0-9]/g, "");

function nameAgrees(catalogTitle: string, productName: string): boolean {
  const words = catalogTitle.split(/[^A-Za-zА-Яа-яІіЇїЄєҐґ0-9]+/).filter((w) => w.length >= 5);
  if (!words.length) return true; // назви в каталозі немає — звіряти нічим
  const haystack = fold(productName);
  return words.some((w) => haystack.includes(fold(w).slice(0, 3)));
}

const eligible = matched.filter((m) => WITH_INACTIVE || m.product.isActive);
const candidates = eligible.filter(
  (m) => m.row.photoUrl && m.row.photoUrl !== m.product.image && (FORCE || !m.product.image || isOurs(m.product.image))
);
const suspicious = SKIP_CHECK ? [] : candidates.filter((m) => !nameAgrees(m.row.title, m.product.name));
const suspiciousIds = new Set(suspicious.map((m) => m.product.id));
const toSet = candidates.filter((m) => !suspiciousIds.has(m.product.id));
const hasImage = eligible.filter((m) => m.product.image && !isOurs(m.product.image) && !FORCE);
const matchedArticles = new Set(matched.map((m) => m.row.article));
const future = index.rows.filter((r) => !matchedArticles.has(r.article));
const matchedIds = new Set(matched.map((m) => m.product.id));
const orphans = products.filter((p) => p.isActive && !matchedIds.has(p.id));

console.log(`Каталог ${index.catalogYear}: ${index.rows.length} артикулів (з фото ${index.rows.filter((r) => r.photoUrl).length})`);
console.log(`Товарів СИЛА у базі: ${products.length} (активних ${products.filter((p) => p.isActive).length})`);
console.log(`Збіглося за артикулом: ${matched.length} (активних ${matched.filter((m) => m.product.isActive).length})`);
console.log(`  поставити фото: ${toSet.length}`);
console.log(`  фото вже є (пропуск, --force замінить): ${hasImage.length}`);
console.log(`  відкладено — назва не збігається з 1С: ${suspicious.length} (застосувати попри це: --ignore-name-check)`);
console.log(`Артикулів каталогу без товару в базі («майбутні»): ${future.length}`);
console.log(`Активних товарів СИЛА поза каталогом: ${orphans.length} (з них із залишком ${orphans.filter((p) => p.stock > 0).length})`);

console.log("\n── Відкладено: назва в каталозі не схожа на назву в 1С (перші 15) ──");
for (const m of suspicious.slice(0, 15)) {
  console.log(`  ${(m.product.sku ?? "—").padEnd(9)} стор.${String(m.row.page).padEnd(4)} «${m.row.title.slice(0, 36)}» ≠ «${m.product.name.slice(0, 44)}»`);
}

console.log("\n── Поставимо фото (перші 30) ──");
for (const m of toSet.slice(0, 30)) {
  console.log(`  ${(m.product.sku ?? "—").padEnd(9)} стор.${String(m.row.page).padEnd(4)} ${m.product.name.slice(0, 68)}`);
}

const stamp = new Date().toISOString().slice(0, 10);
const report = {
  catalogYear: index.catalogYear,
  at: new Date().toISOString(),
  apply: APPLY,
  set: toSet.map((m) => ({
    productId: m.product.id,
    sku: m.product.sku,
    name: m.product.name,
    article: m.row.article,
    page: m.row.page,
    catalogTitle: m.row.title,
    oldImage: m.product.image,
    newImage: m.row.photoUrl,
  })),
  suspicious: suspicious.map((m) => ({
    productId: m.product.id,
    sku: m.product.sku,
    name: m.product.name,
    catalogTitle: m.row.title,
    page: m.row.page,
    photoUrl: m.row.photoUrl,
  })),
  future: future.map((r) => ({ article: r.article, page: r.page, title: r.title, photoUrl: r.photoUrl })),
  orphans: orphans.map((p) => ({ productId: p.id, sku: p.sku, name: p.name, stock: p.stock })),
};
fs.mkdirSync("output/syla-catalog", { recursive: true });
const reportPath = `output/syla-catalog/sync-${stamp}${APPLY ? "-applied" : "-dry"}.json`;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(`\nЗвіт: ${reportPath}`);

if (APPLY) {
  let done = 0;
  for (const m of toSet) {
    await prisma.product.update({ where: { id: m.product.id }, data: { image: m.row.photoUrl } });
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${toSet.length}`);
  }
  console.log(`Оновлено фото: ${done}`);
} else if (toSet.length) {
  console.log("Сухий прогін. Щоб застосувати: --apply");
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
