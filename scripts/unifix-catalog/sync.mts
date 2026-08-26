/**
 * Фото товарів UNIFIX з офіційного каталогу постачальника.
 *
 * Зіставляє артикули каталогу (index.json, опублікований publish.mts) з
 * товарами в базі і ставить `Product.image` тим, у кого фото немає. Товари НЕ
 * створює і ціни НЕ чіпає: асортимент і ціни приходять з 1С, каталог показує
 * лише те, що є в обліку (рішення власника від 18.08.2026). Артикули каталогу,
 * яких у базі нема, лягають у звіт як «майбутні» — коли 1С їх заведе,
 * повторний запуск підхопить фото сам.
 *
 * Зіставлення просте й точне: артикул каталогу дорівнює `sku` товару
 * (951235, SK-540512). Ніякого пошуку за назвою — на відміну від Grösser, тут
 * артикули постачальника і 1С це той самий номер. Шукаємо ЛИШЕ серед бренду
 * UNIFIX: «940017» чи «PN-1210» самі по собі можуть бути артикулом і чужого
 * бренду, а чуже фото на чужому товарі гірше за відсутнє.
 *
 * Одне фото на групу — так у самому каталозі: 40 кольорів емалі стоять під
 * одним знімком балона, скотч 45 мм × 50/100/200 м — під одним знімком рулона.
 *
 * Старі картки з фото (sku виду «28341», вимкнені, привезені зі старого сайту)
 * навмисно не чіпаємо: вони не в обігу.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/unifix-catalog/sync.mts             # звіт, без змін
 *   npx tsx --env-file=.env scripts/unifix-catalog/sync.mts --apply     # поставити фото
 *   --index <url|файл>  інший індекс (типово — catalogs/unifix/latest.json з R2)
 *   --force             замінити і наявні фото (типово ставимо лише порожнім)
 *   --include-inactive  ставити фото й вимкненим карткам
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const WITH_INACTIVE = args.includes("--include-inactive");
const indexArg = args.includes("--index") ? args[args.indexOf("--index") + 1] : null;

type Row = {
  article: string;
  page: number;
  group: string;
  section: string;
  row: string;
  photoUrl: string | null;
};
type Index = { catalogYear: string; pdfUrl: string | null; rows: Row[] };

async function loadIndex(): Promise<Index> {
  let src = indexArg;
  if (!src) {
    const latest = await fetch(`${process.env.R2_PUBLIC_URL}/catalogs/unifix/latest.json`);
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
const byArticle = new Map(index.rows.map((r) => [r.article.toUpperCase(), r]));

const brand = await prisma.brand.findFirst({ where: { name: "UNIFIX" }, select: { id: true } });
if (!brand) throw new Error("Бренд UNIFIX не знайдено");
const products = await prisma.product.findMany({
  where: { brandId: brand.id },
  select: { id: true, sku: true, name: true, image: true, isActive: true, stock: true },
});

type Hit = { product: (typeof products)[number]; row: Row };
const matched: Hit[] = [];
for (const p of products) {
  const row = byArticle.get((p.sku ?? "").trim().toUpperCase());
  if (row) matched.push({ product: p, row });
}

/**
 * Наше фото — те, що ми самі й поставили з цього каталогу. Його оновлюємо
 * без питань: після повторного розбору PDF файл групи може називатись інакше,
 * і картка інакше показувала б фото сусідньої групи. Чужі фото (`/products/…`
 * зі старого сайту, часто зняті окремо для кожного варіанта і вчетверо
 * більші) не чіпаємо — вони кращі за групову світлину з каталогу.
 */
const isOurs = (url: string | null) => !!url && url.includes("/catalogs/unifix/");

const eligible = matched.filter((m) => WITH_INACTIVE || m.product.isActive);
const toSet = eligible.filter(
  (m) => m.row.photoUrl && m.row.photoUrl !== m.product.image && (FORCE || !m.product.image || isOurs(m.product.image))
);
const hasImage = eligible.filter((m) => m.product.image && !isOurs(m.product.image) && !FORCE);
const matchedArticles = new Set(matched.map((m) => m.row.article));
const future = index.rows.filter((r) => !matchedArticles.has(r.article));
const matchedIds = new Set(matched.map((m) => m.product.id));
const orphans = products.filter((p) => p.isActive && !matchedIds.has(p.id));

console.log(`Каталог ${index.catalogYear}: ${index.rows.length} артикулів`);
console.log(`Товарів UNIFIX у базі: ${products.length} (активних ${products.filter((p) => p.isActive).length})`);
console.log(`Збіглося за артикулом: ${matched.length} (з них активних ${matched.filter((m) => m.product.isActive).length})`);
console.log(`  поставити фото: ${toSet.length}`);
console.log(`  фото вже є (пропуск, --force замінить): ${hasImage.length}`);
console.log(`Артикулів каталогу без товару в базі («майбутні»): ${future.length}`);
console.log(`Активних товарів UNIFIX поза каталогом: ${orphans.length} (з них із залишком ${orphans.filter((p) => p.stock > 0).length})`);

console.log("\n── Поставимо фото (перші 40) ──");
for (const m of toSet.slice(0, 40)) {
  console.log(`  ${(m.product.sku ?? "—").padEnd(14)} стор.${String(m.row.page).padEnd(3)} ${m.product.name.slice(0, 62)}`);
}
console.log("\n── Майбутні (в каталозі є, в базі нема) ──");
for (const r of future) console.log(`  ${r.article.padEnd(14)} стор.${String(r.page).padEnd(3)} ${r.section.slice(0, 45)}`);

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
    oldImage: m.product.image,
    newImage: m.row.photoUrl,
  })),
  future: future.map((r) => ({ article: r.article, page: r.page, section: r.section, row: r.row, photoUrl: r.photoUrl })),
  orphans: orphans.map((p) => ({ productId: p.id, sku: p.sku, name: p.name, stock: p.stock })),
};
fs.mkdirSync("output/unifix-catalog", { recursive: true });
const reportPath = `output/unifix-catalog/sync-${stamp}${APPLY ? "-applied" : "-dry"}.json`;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(`\nЗвіт: ${reportPath}`);

if (APPLY) {
  let done = 0;
  for (const m of toSet) {
    await prisma.product.update({ where: { id: m.product.id }, data: { image: m.row.photoUrl } });
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${toSet.length}`);
  }
  console.log(`Оновлено фото: ${done}`);
} else if (toSet.length) {
  console.log("Сухий прогін. Щоб застосувати: --apply");
}
await prisma.$disconnect();
