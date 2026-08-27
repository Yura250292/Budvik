/**
 * Фото і характеристики METEC з офіційного каталогу постачальника.
 *
 * Каталог METEC — презентація: одна сторінка = один товар = один знімок =
 * один артикул. Геометричної неоднозначності, як у СИЛІ чи 12 Atelie, тут
 * немає взагалі; єдиний ризик — помилка зору в шестизначному номері, тому
 * publish.mts перевіряє, що артикули не повторюються.
 *
 * Назви в каталозі місцями розходяться з 1С (стор. 19 підписана «IR-10CBB»,
 * хоча за артикулом 700300 в обліку «IR-01CBW» — і на сторінці справді біла
 * праска, тобто помилка в підписі каталогу). Тому звіряємо за артикулом, а
 * розбіжність назв лише виносимо у звіт.
 *
 * З `--descriptions` дописує в кінець опису секцію «Характеристики:» з
 * таблиці сторінки — рівно той формат, який розбирає splitDescription
 * (src/lib/catalog/description-sections.ts) і показує карткою під фото.
 * Проза опису лишається недоторканою, повторний запуск замінює лише свою
 * секцію.
 *
 * Товари НЕ створює і ціни НЕ чіпає: асортимент і ціни приходять з 1С.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/metec-catalog/sync.mts                # звіт
 *   npx tsx --env-file=.env scripts/metec-catalog/sync.mts --apply --descriptions
 *   --index <url|файл>  інший індекс (типово — catalogs/metec/latest.json)
 *   --force             замінити і наявні фото
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
  name: string;
  model: string | null;
  specs: { key: string; value: string }[];
  features: string[];
  photoUrl: string;
};
type Index = { catalogYear: string; pdfUrl: string | null; rows: Row[] };

async function loadIndex(): Promise<Index> {
  let src = indexArg;
  if (!src) {
    const latest = await fetch(`${process.env.R2_PUBLIC_URL}/catalogs/metec/latest.json`);
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

function withSection(description: string, specs: Row["specs"]): string {
  const rows = specs.filter((s) => s.key.trim() && s.value.trim());
  if (rows.length < 2) return description ?? "";
  const section = [HEADING, ...rows.map((s) => `• ${s.key.trim()}: ${s.value.trim()}`)].join("\n");
  const base = stripSection(description ?? "");
  return base ? `${base}\n\n${section}` : section;
}

const index = await loadIndex();
const byArticle = new Map(index.rows.map((r) => [r.article.trim(), r]));

const brand = await prisma.brand.findFirst({ where: { slug: "metec" }, select: { id: true } });
if (!brand) throw new Error("Бренд METEC не знайдено");
const products = await prisma.product.findMany({
  where: { brandId: brand.id },
  select: { id: true, sku: true, name: true, image: true, isActive: true, stock: true, description: true },
});

type Hit = { product: (typeof products)[number]; row: Row };
const matched: Hit[] = [];
for (const p of products) {
  const row = byArticle.get((p.sku ?? "").trim());
  if (row) matched.push({ product: p, row });
}

const isOurs = (url: string | null) => !!url && url.includes("/catalogs/metec/");

const eligible = matched.filter((m) => WITH_INACTIVE || m.product.isActive);
const toSet = eligible.filter(
  (m) => m.row.photoUrl !== m.product.image && (FORCE || !m.product.image || isOurs(m.product.image))
);
const hasImage = eligible.filter((m) => m.product.image && !isOurs(m.product.image) && !FORCE);
const toDescribe = eligible.filter((m) => withSection(m.product.description ?? "", m.row.specs) !== (m.product.description ?? ""));
/** Модель із назви каталогу мала б зустрічатись і в назві 1С — інакше це варто побачити очима. */
const nameGap = eligible.filter((m) => m.row.model && !m.product.name.toUpperCase().includes(m.row.model.toUpperCase()));
const matchedArticles = new Set(matched.map((m) => m.row.article));
const future = index.rows.filter((r) => !matchedArticles.has(r.article));
const matchedIds = new Set(matched.map((m) => m.product.id));
const orphans = products.filter((p) => p.isActive && !matchedIds.has(p.id));

console.log(`Каталог ${index.catalogYear}: ${index.rows.length} товарів`);
console.log(`Товарів METEC у базі: ${products.length} (активних ${products.filter((p) => p.isActive).length})`);
console.log(`Збіглося за артикулом: ${matched.length} (активних ${matched.filter((m) => m.product.isActive).length})`);
console.log(`  поставити фото: ${toSet.length}`);
console.log(`  фото вже є (пропуск, --force замінить): ${hasImage.length}`);
console.log(`  дописати «Характеристики:»: ${toDescribe.length}${DESCRIPTIONS ? "" : "  (увімкнути: --descriptions)"}`);
console.log(`Артикулів каталогу без товару в базі («майбутні»): ${future.length}`);
console.log(`Активних товарів METEC поза каталогом: ${orphans.length} (з них із залишком ${orphans.filter((p) => p.stock > 0).length})`);

if (nameGap.length) {
  console.log("\n── Модель із каталогу не збігається з назвою в 1С (звіряти очима) ──");
  for (const m of nameGap) {
    console.log(`  ${m.product.sku}  стор.${m.row.page}  каталог «${m.row.name.slice(0, 40)}» ≠ 1С «${m.product.name.slice(0, 46)}»`);
  }
}

console.log("\n── Поставимо фото ──");
for (const m of toSet.slice(0, 40)) {
  console.log(`  ${(m.product.sku ?? "—").padEnd(9)} стор.${String(m.row.page).padEnd(3)} ${m.product.name.slice(0, 66)}`);
}
if (future.length) {
  console.log("\n── Майбутні (в каталозі є, в базі нема) ──");
  for (const r of future) console.log(`  ${r.article.padEnd(9)} стор.${String(r.page).padEnd(3)} ${r.name.slice(0, 60)}`);
}

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
    catalogName: m.row.name,
    page: m.row.page,
    oldImage: m.product.image,
    newImage: m.row.photoUrl,
  })),
  described: toDescribe.map((m) => ({ productId: m.product.id, sku: m.product.sku, specs: m.row.specs, oldDescription: m.product.description })),
  nameGap: nameGap.map((m) => ({ sku: m.product.sku, page: m.row.page, catalogName: m.row.name, dbName: m.product.name })),
  future: future.map((r) => ({ article: r.article, page: r.page, name: r.name, photoUrl: r.photoUrl })),
  orphans: orphans.map((p) => ({ productId: p.id, sku: p.sku, name: p.name, stock: p.stock })),
};
fs.mkdirSync("output/metec-catalog", { recursive: true });
const reportPath = `output/metec-catalog/sync-${stamp}${APPLY ? "-applied" : "-dry"}.json`;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(`\nЗвіт: ${reportPath}`);

if (APPLY) {
  for (const m of toSet) {
    await prisma.product.update({ where: { id: m.product.id }, data: { image: m.row.photoUrl } });
  }
  console.log(`Оновлено фото: ${toSet.length}`);
  if (DESCRIPTIONS) {
    for (const m of toDescribe) {
      await prisma.product.update({
        where: { id: m.product.id },
        data: { description: withSection(m.product.description ?? "", m.row.specs) },
      });
    }
    console.log(`Дописано характеристик: ${toDescribe.length}`);
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
