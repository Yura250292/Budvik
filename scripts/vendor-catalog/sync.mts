/**
 * Фото й описи з сайту виробника → у картки товарів.
 *
 * Чого НЕ робить: не створює товарів (номенклатура тільки з 1С), не чіпає
 * ціни й наявність, не переписує наявні фото (для заміни є --force).
 *
 * Опис за домовчанням ставиться лише туди, де його по суті немає: зараз у
 * більшості карток стоїть текст, який модель вигадала з самої назви, і в
 * частині випадків це відверте «товар не визначено». Дані виробника точніші,
 * але переписувати ВСІ описи скопом — окреме рішення, тому --descriptions.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/vendor-catalog/sync.mts makita                 # звіт
 *   npx tsx --env-file=.env scripts/vendor-catalog/sync.mts makita --apply
 *   --descriptions      ще й описи (порожні та вигадані моделлю)
 *   --all-descriptions  описи навіть там, де вже є нормальний текст
 *   --force             замінити і наявні фото
 *   --index <url|файл>  інший індекс (типово catalogs/<джерело>/site-latest.json)
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { vendorBySlug, normArticle, describe, similarity, sharedNumbers, type Specs } from "./vendors";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : null);
const slug = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
if (!slug) throw new Error("вкажіть джерело, напр. makita");
const vendor = vendorBySlug(slug);
const APPLY = flag("apply");
const FORCE = flag("force");
const DESCR = flag("descriptions") || flag("all-descriptions");
const DESCR_ALL = flag("all-descriptions");

type Row = { article: string; vendorArticle: string; title: string; photoUrl: string | null; source: string; specs: Specs; text: string | null; description: string };
type Index = { vendor: string; brand: string; catalogDate: string; source: string; rows: Row[] };

async function loadIndex(): Promise<Index> {
  const src = opt("index");
  if (src) {
    if (src.startsWith("http")) return (await (await fetch(src)).json()) as Index;
    const file = fs.statSync(src).isDirectory() ? `${src}/index.json` : src;
    return JSON.parse(fs.readFileSync(file, "utf8")) as Index;
  }
  const publicUrl = process.env.R2_PUBLIC_URL;
  if (!publicUrl) throw new Error("R2_PUBLIC_URL не заданий і --index не вказано");
  const latest = (await (await fetch(`${publicUrl}/catalogs/${vendor.slug}/site-latest.json`)).json()) as { indexUrl: string };
  return (await (await fetch(latest.indexUrl)).json()) as Index;
}

/**
 * Опис, який насправді нічого не описує.
 *
 * Історія: описи колись згенерувала модель із самих назв, і там, де назва була
 * прізвищем контрагента чи службовим рядком, вона чесно написала «товар не
 * визначено». Такий текст замінюємо без вагань.
 */
const isWeak = (d: string | null | undefined) =>
  !d ||
  d.trim().length < 40 ||
  /(відсутн|не визначено|неможлив|не містить|інформація про товар|не може бути описан)/i.test(d);

const index = await loadIndex();
console.log(`Джерело: ${index.brand} (${index.source}), зріз ${index.catalogDate}, карток ${index.rows.length}`);

const brands = await prisma.brand.findMany({ where: { slug: { in: vendor.brands } }, select: { id: true, name: true } });
const brandIds = new Set(brands.map((b) => b.id));

const products = await prisma.product.findMany({
  where: { sku: { in: index.rows.map((r) => r.article) } },
  select: { id: true, sku: true, name: true, image: true, description: true, stock: true, isActive: true, brandId: true, brand: { select: { name: true } } },
});
const bySku = new Map(products.map((p) => [normArticle(p.sku!), p]));

type Change = { sku: string; name: string; photo?: { from: string | null; to: string }; text?: { from: string; to: string } };
const changes: Change[] = [];
const kept: string[] = [];
const foreign: string[] = [];
const absent: string[] = [];
const mismatched: string[] = [];
const weakMatch: string[] = []; // збіглося, але назви схожі слабко — варто глянути очима

for (const r of index.rows) {
  const p = bySku.get(normArticle(r.article));
  if (!p) { absent.push(r.article); continue; }
  if (!p.brandId && vendor.unbranded) {
    // У картки немає бренду, тож збіг артикулу — єдиний доказ. Вимагаємо ще й
    // впізнаваної назви: нумерація постачальників місцями перетинається, і
    // без цієї перевірки «Рукавиці 83-0601» могли б отримати чуже фото.
    const sim = similarity(p.name, r.title);
    const nums = sharedNumbers(p.name, r.title);
    // Або назви схожі, або збігається хоча б один розмір при не нульовій
    // схожості. Самого артикулу мало, але й одних слів мало: у MASTERTOOL
    // «Стусло» називається «Навскісник столярний», а «Ліска струна» —
    // «Жилка для тримера».
    const ok = sim >= 0.25 || (nums >= 1 && sim >= 0.04);
    if (!ok) {
      mismatched.push(`${r.article} (схожість ${sim.toFixed(2)}, спільних розмірів ${nums}) наше «${p.name.slice(0, 42)}» ≠ сайт «${r.title.slice(0, 42)}»`);
      continue;
    }
    if (sim < 0.25) weakMatch.push(`${r.article} (${sim.toFixed(2)}, розміри ${nums}) «${p.name.slice(0, 38)}» ~ «${r.title.slice(0, 38)}»`);
  } else if (!brandIds.has(p.brandId ?? "") && !(vendor.ourProduct?.(p.name) ?? false)) {
    // Артикул збігся, але картка чужого бренду — фото виробника їй не належить.
    foreign.push(`${r.article} → «${p.name}» (бренд ${p.brand?.name ?? "—"})`);
    continue;
  }
  const c: Change = { sku: p.sku!, name: p.name };
  if (r.photoUrl && (!p.image || FORCE)) c.photo = { from: p.image, to: r.photoUrl };
  else if (p.image) kept.push(r.article);
  // Опис виробника кладемо там, де наш текст слабкий, АБО там, де сайт дав
  // справжні характеристики: пара «Тип диска: WA60T» точніша за будь-який
  // переказ назви — у D-18770 наша назва взагалі каже «для металу», тоді як
  // Makita пише «для нержавіючої сталі».
  const hasFacts = Object.keys(r.specs ?? {}).length >= 2;
  // Текст складаємо тут, а не в fetch: тоді правка формулювання не вимагає
  // ані нового обходу сайту, ані перезаливки фото в R2.
  const fresh = describe(r.title, r.specs ?? {}, r.text ?? null);
  if (DESCR && fresh.length >= 20 && (DESCR_ALL || hasFacts || isWeak(p.description))) {
    if (fresh.trim() !== (p.description ?? "").trim()) c.text = { from: p.description ?? "", to: fresh };
  }
  if (c.photo || c.text) changes.push(c);
}

const withPhoto = changes.filter((c) => c.photo);
const withText = changes.filter((c) => c.text);
console.log(`\nЗіставлено з базою: ${index.rows.length - absent.length} із ${index.rows.length}`);
console.log(`  поставити фото: ${withPhoto.length}`);
console.log(`  фото вже є (пропускаємо${FORCE ? " — але --force" : ""}): ${kept.length}`);
console.log(`  оновити опис: ${withText.length}${DESCR ? "" : " (вимкнено; увімкнути --descriptions)"}`);
if (weakMatch.length) console.log(`  збіг слабкий, але прийнято (гляньте): ${weakMatch.length}\n    ${weakMatch.slice(0, 20).join("\n    ")}`);
if (mismatched.length) console.log(`  назва не збіглася, не чіпаємо: ${mismatched.length}\n    ${mismatched.slice(0, 90).join("\n    ")}`);
if (foreign.length) console.log(`  чужий бренд, не чіпаємо: ${foreign.length}\n    ${foreign.slice(0, 15).join("\n    ")}`);
if (absent.length) console.log(`  на сайті є, у базі нема: ${absent.length} — ${absent.slice(0, 25).join(", ")}`);

for (const c of changes.slice(0, 25)) {
  if (c.photo) console.log(`  ${c.sku} фото ${c.photo.from ? "заміна" : "порожньо"} → ${c.photo.to}`);
  if (c.text) console.log(`  ${c.sku} опис  «${c.text.from.slice(0, 45).replace(/\n/g, " ")}…» → «${c.text.to.slice(0, 70).replace(/\n/g, " ")}…»`);
}
if (changes.length > 25) console.log(`  … ще ${changes.length - 25}`);

const stillEmpty = await prisma.product.count({
  where: { brandId: { in: [...brandIds] }, isActive: true, OR: [{ image: null }, { image: "" }], sku: { notIn: withPhoto.map((c) => c.sku) } },
});
console.log(`\nБез фото лишиться по цих брендах: ${stillEmpty}`);

if (!APPLY) {
  console.log("\nЦе звіт. Щоб застосувати — --apply");
  await prisma.$disconnect();
  process.exit(0);
}

const backup = `scripts/backup-${vendor.slug}-site-${new Date().toISOString().slice(0, 10)}.json`;
fs.writeFileSync(backup, JSON.stringify(changes, null, 1));
console.log(`\nЗлiпок попереднього стану: ${backup}`);

for (const c of changes) {
  await prisma.product.update({
    where: { sku: c.sku },
    data: { ...(c.photo ? { image: c.photo.to } : {}), ...(c.text ? { description: c.text.to } : {}) },
  });
}
console.log(`Оновлено карток: ${changes.length} (фото ${withPhoto.length}, описів ${withText.length})`);

// Вітрина кешується (ISR) — без цього фото з'явиться лише за годину.
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
await prisma.$disconnect();
