/**
 * Каталог Polax → R2 → база: фото, штрихкоди, бренд, описи.
 *
 * Джерело — офіційний PDF-каталог виробника, розібраний у маніфест
 * (scripts/polax-catalog/parse_catalog.py). Маніфест і всі фото лежать на R2
 * під catalogs/polax/2026/, тож коли з 1С приїде новий товар Polax, якого ще
 * не було, достатньо знову запустити `--apply` — фото підтягнеться за
 * артикулом без повторного розбору PDF.
 *
 * Зіставлення — лише серед товарів бренду POLAX (brandId або «POLAX» у
 * назві): артикули виду «19-001» у базі є і в Бригадира, і в Foresta, і
 * в KT Profi, тож збіг самого артикулу без бренду означав би чуже фото
 * на чужому товарі.
 *
 * Чого НЕ робить: не перезаписує наявні фото та описи (лише порожні), не
 * створює товарів — номенклатура приходить тільки з 1С.
 *
 * Запуск:
 *   npx tsx scripts/polax-catalog-sync.mts --upload <out-dir> --pdf "<каталог.pdf>"
 *   npx tsx scripts/polax-catalog-sync.mts --apply --dry [--sample 19-001,25-011]   # звіт без змін
 *   npx tsx scripts/polax-catalog-sync.mts --apply                 # маніфест з R2
 *   npx tsx scripts/polax-catalog-sync.mts --apply --manifest <out-dir>/manifest.json
 *   npx tsx scripts/polax-catalog-sync.mts --apply --report absent.json   # артикули каталогу, яких нема в базі
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { basename, join } from "path";

try { (await import("dotenv")).config(); } catch { /* env уже в оточенні */ }

const { PrismaClient } = await import("@prisma/client");
const { uploadFile } = await import("../src/lib/r2");

const PREFIX = "catalogs/polax/2026";
const BRAND_NAME = "POLAX";

type Item = {
  article: string; ean: string | null; heading: string; page: number;
  features: Record<string, string>; params: Record<string, string>; packaging: string | null;
  image: string | null; extraImages: string[];
};
type Manifest = { brand: string; catalog: string; source: string; builtAt: string; stats: unknown; items: Item[] };

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const publicUrl = (key: string) => `${process.env.R2_PUBLIC_URL}/${key}`;

async function runPool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

// ---------------------------------------------------------------- upload

async function upload(dir: string, pdf?: string) {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`Немає ${manifestPath} — спершу parse_catalog.py`);
  const files: { key: string; path: string; type: string }[] = [];
  for (const f of readdirSync(join(dir, "images"))) {
    if (f.endsWith(".jpg")) files.push({ key: `${PREFIX}/images/${f}`, path: join(dir, "images", f), type: "image/jpeg" });
  }
  for (const f of readdirSync(join(dir, "images", "k"))) {
    if (f.endsWith(".jpg")) files.push({ key: `${PREFIX}/images/k/${f}`, path: join(dir, "images", "k", f), type: "image/jpeg" });
  }
  if (pdf) files.push({ key: `${PREFIX}/${basename(pdf)}`, path: pdf, type: "application/pdf" });
  // Маніфест — останнім: поки він не оновився, `--apply` бачить лише повний попередній набір.
  files.push({ key: `${PREFIX}/manifest.json`, path: manifestPath, type: "application/json" });
  let done = 0, failed = 0;
  await runPool(files, 8, async (f) => {
    try {
      await uploadFile(readFileSync(f.path), f.key, f.type);
      done++;
      if (done % 200 === 0) console.log(`  ${done}/${files.length}`);
    } catch (e) {
      failed++;
      console.error("  не вивантажено", f.key, (e as Error).message);
    }
  });
  console.log(`Вивантажено ${done} з ${files.length} (помилок ${failed}) → ${publicUrl(PREFIX)}/`);
}

// ---------------------------------------------------------------- description

const LATIN_TOKEN = /^[A-Z][A-Z0-9\-]+$/;
/** «ВАЛИК «МУЛЬТИКОЛОР»» → «Валик «Мультиколор»»; абревіатури (TORX, PROFI, У2К) лишаються як є. */
function sentenceCase(s: string): string {
  const lower = s.split(" ").map((w) => (LATIN_TOKEN.test(w) || /\d/.test(w) ? w : w.toLowerCase())).join(" ");
  return lower
    .replace(/^(\P{L}*)(\p{L})/u, (_, p, c) => p + c.toUpperCase())
    .replace(/«(\p{L})/gu, (_, c) => "«" + c.toUpperCase());
}
/**
 * Заголовок колонки з PDF інколи склеєний із підписом піктограми над ним
 * («Xром - ванадієва сталь Розмір, мм»). Беремо останню фразу, що починається
 * з великої літери й далі йде малими: це і є назва колонки.
 */
const COLUMN_TAIL = /(\p{Lu}[\p{Ll}’'.]*(?:\s+[\p{Ll}’'()"/.]+)*)(,\s*[\p{L}"/\s().]{1,12})?$/u;
function columnName(key: string): { name: string; unit?: string } | null {
  const m = key.trim().match(COLUMN_TAIL);
  if (!m) return null;
  return { name: m[1].trim(), unit: m[2]?.replace(/^,\s*/, "").trim() || undefined };
}

function buildDescription(item: Item): string {
  const lines: string[] = [sentenceCase(item.heading) + "."];
  for (const [k, v] of Object.entries(item.features)) {
    if (v.trim()) lines.push(`${sentenceCase(k)}: ${v.trim().replace(/\s+/g, " ")}`);
  }
  const specs: string[] = [];
  let packaging = item.packaging;
  for (const [k, v] of Object.entries(item.params)) {
    if (!v.trim()) continue;
    if (/пакувальн|^дані$/iu.test(k)) { packaging ??= v.trim(); continue; }
    const col = columnName(k);
    if (!col || col.name.length > 32) continue;
    specs.push(`${sentenceCase(col.name)}: ${v.trim()}${col.unit ? " " + col.unit : ""}`);
  }
  if (specs.length) lines.push("Характеристики — " + specs.join("; ") + ".");
  if (packaging) lines.push(`Пакування: ${packaging}.`);
  lines.push(`Артикул POLAX ${item.article}.`);
  return lines.join("\n");
}

// ---------------------------------------------------------------- apply

const ART = /^(\d{1,4}-\d{3}[A-Za-zА-Яа-я]?)(?:\b|$)/;

async function apply(dry: boolean, manifestPath?: string, reportPath?: string) {
  const manifest: Manifest = manifestPath
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : await (await fetch(publicUrl(`${PREFIX}/manifest.json`))).json();
  const byArticle = new Map(manifest.items.map((i) => [i.article, i]));
  console.log(`Маніфест: ${manifest.catalog}, ${byArticle.size} артикулів, зібрано ${manifest.builtAt}`);

  const prisma = new PrismaClient();
  const brand = await prisma.brand.findUnique({ where: { name: BRAND_NAME } });
  if (!brand) throw new Error(`Бренду ${BRAND_NAME} немає в базі`);
  const products = await prisma.product.findMany({
    where: { OR: [{ brandId: brand.id }, { name: { contains: "polax", mode: "insensitive" } }] },
    select: { id: true, sku: true, name: true, brandId: true, image: true, barcodes: true, description: true },
  });

  const norm = (sku: string | null) => { const m = (sku || "").trim().match(ART); return m ? m[1] : null; };
  const updates: { id: string; sku: string | null; data: Record<string, unknown> }[] = [];
  const stat = { matched: 0, image: 0, barcode: 0, brand: 0, description: 0 };
  const present = new Set<string>();
  for (const p of products) {
    const sku = p.sku?.trim() ?? "";
    const key = byArticle.has(sku) ? sku : norm(sku) && byArticle.has(norm(sku)!) ? norm(sku)! : null;
    const data: Record<string, unknown> = {};
    if (p.brandId !== brand.id) { data.brandId = brand.id; stat.brand++; }
    if (key) {
      stat.matched++; present.add(key);
      const item = byArticle.get(key)!;
      if (!p.image && item.image) { data.image = publicUrl(`${PREFIX}/${item.image}`); stat.image++; }
      if (item.ean && !p.barcodes.includes(item.ean)) { data.barcodes = { push: item.ean }; stat.barcode++; }
      if (!p.description?.trim()) { data.description = buildDescription(item); stat.description++; }
    }
    if (Object.keys(data).length) updates.push({ id: p.id, sku: p.sku, data });
  }
  const absent = manifest.items.filter((i) => !present.has(i.article));
  console.log(`Товарів POLAX у базі: ${products.length}; збіглося з каталогом: ${stat.matched}`);
  console.log(`Оновлень: ${updates.length} — фото ${stat.image}, штрихкоди ${stat.barcode}, бренд ${stat.brand}, описи ${stat.description}`);
  console.log(`Артикулів каталогу, яких нема в базі: ${absent.length}`);
  if (reportPath) {
    writeFileSync(reportPath, JSON.stringify(absent.map((i) => ({ article: i.article, ean: i.ean, heading: i.heading, page: i.page, image: i.image && publicUrl(`${PREFIX}/${i.image}`) })), null, 1));
    console.log(`  список → ${reportPath}`);
  }
  if (dry) {
    const wanted = (opt("--sample") ?? "").split(",").filter(Boolean);
    for (const a of wanted) { const it = byArticle.get(a); if (it) console.log(`\n=== ${a} (стор. ${it.page})\n` + buildDescription(it)); }
    const sample = updates.find((u) => u.data.description);
    if (!wanted.length && sample) console.log("\nПриклад опису (" + sample.sku + "):\n" + sample.data.description);
    console.log("\n--dry: базу не чіпаємо");
  } else {
    for (let i = 0; i < updates.length; i += 100) {
      await prisma.$transaction(updates.slice(i, i + 100).map((u) => prisma.product.update({ where: { id: u.id }, data: u.data })));
      console.log(`  ${Math.min(i + 100, updates.length)}/${updates.length}`);
    }
    console.log("Готово.");
  }
  await prisma.$disconnect();
}

if (flag("--upload")) {
  await upload(opt("--upload")!, opt("--pdf"));
} else if (flag("--apply")) {
  await apply(flag("--dry"), opt("--manifest"), opt("--report"));
} else {
  console.log("Використання: --upload <dir> [--pdf file] | --apply [--dry] [--manifest file] [--report file]");
}
