/**
 * Фото товарів Grösser з офіційного каталогу постачальника.
 *
 * Зіставляє рядки каталогу (index.json, опублікований publish.mts) з товарами
 * в базі і ставить `Product.image` тим, у кого фото немає. Товари НЕ
 * створює і ціни НЕ чіпає: асортимент і ціни приходять з 1С, каталог показує
 * лише те, що є в обліку (рішення власника від 18.08.2026). Рядки каталогу,
 * яких у базі нема, лягають у звіт як «майбутні» — коли 1С їх заведе,
 * повторний запуск підхопить фото сам.
 *
 * Як зіставляємо (від надійного до слабшого):
 *   3 — артикул постачальника G0362 у sku або назві («GC 1.5 g0159»);
 *   3 — sku дорівнює моделі («GCS 601»);
 *   2 — назва містить модель цілим словом («… пила ланцюгова GCS 120HS»);
 *   2 — явний псевдонім (WH 5000 ↔ WN 5000 — в каталозі і 1С назви розійшлись);
 *   1 — «ядро» моделі, перші два токени («GMIG 315P Pulse function» → GMIG 315P).
 * Кожен товар дістається рядку з найвищим балом; нічия — в звіт як
 * неоднозначність, нічого не ставимо. Кириличні двійники латиниці («GCD 601Т»
 * з українською Т) зводимо до латиниці токен за токеном, інакше GCD 601 і
 * GCD 601T злипаються.
 *
 * Що навмисно поза зіставленням:
 *   - «РЕМОНТ …» — сервісні позиції 1С, не товар;
 *   - набори, в назві яких кілька моделей («GPS 400+GSP 250+GCS 851») — вони
 *     збігаються з кожною складовою, а фото складової — не фото набору;
 *   - товар, який уже отримав рядок за артикулом чи sku, не бере участі в
 *     пошуку за назвою: ланцюг «12" 1/4 63T (GCS 122)» містить модель пили,
 *     але це ланцюг.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/grosser-catalog/sync.mts            # звіт, без змін
 *   npx tsx --env-file=.env scripts/grosser-catalog/sync.mts --apply    # поставити фото
 *   --index <url|файл>  інший індекс (типово — catalogs/grosser/latest.json з R2)
 *   --force             замінити і наявні фото (типово ставимо лише порожнім)
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FORCE = args.includes("--force");
const indexArg = args.includes("--index") ? args[args.indexOf("--index") + 1] : null;
const DEBUG_SKU = args.includes("--debug") ? args[args.indexOf("--debug") + 1] : null; // показати кандидатів одного товару

// ── індекс каталогу ─────────────────────────────────────────────────────────
type Row = {
  page: number;
  article: string;
  model: string;
  kind: string;
  boxQty: number | null;
  optUsd: number | null;
  rrcUah: number | null;
  photoUrl: string | null;
  specUrl: string | null;
};
type Index = { catalogDate: string; pdfUrl: string | null; rows: Row[] };

async function loadIndex(): Promise<Index> {
  let src = indexArg;
  if (!src) {
    const latest = await fetch(`${process.env.R2_PUBLIC_URL}/catalogs/grosser/latest.json`);
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

// ── нормалізація ────────────────────────────────────────────────────────────
const HOMOGLYPHS: Record<string, string> = {
  А: "A", В: "B", С: "C", Е: "E", Н: "H", І: "I", К: "K", М: "M", О: "O", Р: "P", Т: "T", Х: "X",
};
/** Токен із латиницею/цифрами, де кирилиця лише «схожа» — переписуємо латиницею. */
function fixToken(t: string): string {
  if (!/[A-Z0-9]/.test(t)) return t;
  return t.replace(/[А-ЯІ]/g, (c) => HOMOGLYPHS[c] ?? c);
}
function norm(s: string | null | undefined): string {
  return (s ?? "")
    .toUpperCase()
    .split(/[\s\-_()[\]]+/) // дужки теж межа токена: «601(Каркас)» ≠ «601 КАРКАС» без цього
    .map(fixToken)
    .join("")
    .replace(/[^A-Z0-9А-ЯІЇЄҐ/.+,]/g, "");
}
/** «GMIG 315P Pulse function» → «GMIG315P»; коротким моделям ядро не потрібне. */
function core(model: string): string | null {
  const t = model.trim().split(/\s+/);
  if (t.length < 3 || !/^[A-Za-z]+$/.test(t[0]) || !/^\d/.test(t[1])) return null;
  return norm(`${t[0]} ${t[1]}`);
}
const GCODE = /\bG\s?0\d{3}\b/gi;

/** Каталог ↔ 1С: різні назви одного товару. Ключ — модель у каталозі, значення — sku/модель у базі. */
const ALIASES: Record<string, string> = {
  "WH 5000": "WN 5000",
  "WH 8000": "WN 8000",
  "GOC 24 OL": "GOC 24L",
  "GOC 50 OL": "GAC 50 OL",
  "GOC 50/2 OL": "GAC 50/2 OL",
};

// ── товари ──────────────────────────────────────────────────────────────────
// «ö» у назвах з 1С трапляється у двох Unicode-формах: складеній (U+00F6) і
// розкладеній (o + U+0308). Для Postgres це різні рядки — саме тому в базі два
// бренди «Grösser» (slug grosser і gro-sser), а contains з однією формою губить
// третину товарів. Шукаємо обома формами і за slug брендів.
const GROSSER_FORMS = ["Grösser".normalize("NFC"), "Grösser".normalize("NFD"), "Grosser", "Grasser"];
const products = await prisma.product.findMany({
  where: {
    OR: [
      { brand: { slug: { in: ["grosser", "gro-sser", "grasser"] } } },
      ...GROSSER_FORMS.map((f) => ({ name: { contains: f, mode: "insensitive" as const } })),
      { sku: { startsWith: "G0" } },
    ],
  },
  select: { id: true, sku: true, name: true, image: true, isActive: true, stock: true },
});

const index = await loadIndex();
const rows = index.rows;
console.log(`Каталог ${index.catalogDate}: ${rows.length} рядків. Товарів Grösser у базі: ${products.length}, активних: ${products.filter((p) => p.isActive).length}`);

const modelSet = new Set(rows.map((r) => norm(r.model)).filter((m) => m.length >= 4));
function modelsInName(name: string): number {
  const n = norm(name);
  let count = 0;
  for (const m of modelSet) if (n.includes(m)) count++;
  return count;
}

type Hit = { row: Row; score: number; how: string };
const best = new Map<string, Hit[]>(); // productId → кандидати

function add(p: (typeof products)[number], row: Row, score: number, how: string) {
  const list = best.get(p.id) ?? [];
  if (!list.some((h) => h.row.article === row.article)) list.push({ row, score, how });
  best.set(p.id, list);
}

const eligible = products.filter((p) => !/^РЕМОНТ/i.test(p.name.trim()));
// 1) артикул і sku
for (const p of eligible) {
  const codes = new Set([...(p.sku ?? "").matchAll(GCODE), ...p.name.matchAll(GCODE)].map((m) => norm(m[0])));
  const sku = p.sku && !p.sku.startsWith("1C-") ? norm(p.sku) : "";
  for (const r of rows) {
    if (codes.has(norm(r.article))) add(p, r, 3, "артикул");
    const m = norm(r.model);
    // Точна рівність цілого sku безпечна і для коротких моделей (GS-1, GH-3);
    // поріг у 4 символи лишається для пошуку підрядка в назві нижче.
    if (sku && m.length >= 3 && sku === m) add(p, r, 3, "sku");
    const alias = ALIASES[r.model.trim()];
    if (alias && (sku === norm(alias) || norm(p.name).includes(norm(alias)))) add(p, r, 2, "псевдонім");
  }
}
// 2) назва і ядро — лише для тих, хто ще нікуди не потрапив
for (const p of eligible) {
  if (best.has(p.id)) continue;
  if (modelsInName(p.name) > 1) continue; // набір з кількох моделей
  const n = norm(p.name);
  const sku = p.sku && !p.sku.startsWith("1C-") ? norm(p.sku) : "";
  for (const r of rows) {
    const m = norm(r.model);
    if (m.length >= 4) {
      const i = n.indexOf(m);
      if (i >= 0 && !/[A-Z0-9]/.test(n[i + m.length] ?? "")) add(p, r, 2, "назва");
    }
    const c = core(r.model);
    if (c && (sku === c || (n.includes(c) && !/[A-Z0-9]/.test(n[n.indexOf(c) + c.length] ?? "")))) add(p, r, 1, "ядро");
  }
}

if (DEBUG_SKU) {
  for (const p of products.filter((x) => x.sku === DEBUG_SKU || x.name.includes(DEBUG_SKU))) {
    console.log(`\n[debug] ${p.sku} | ${p.name} | active=${p.isActive} eligible=${eligible.includes(p)} norm(sku)=${norm(p.sku)}`);
    for (const h of best.get(p.id) ?? []) console.log(`  кандидат ${h.row.article} ${h.row.model} norm=${norm(h.row.model)} [${h.how}] ${h.score}`);
  }
}

// ── розподіл ────────────────────────────────────────────────────────────────
type Assigned = { product: (typeof products)[number]; row: Row; how: string };
const assigned: Assigned[] = [];
const ambiguous: { product: (typeof products)[number]; hits: Hit[] }[] = [];
for (const p of eligible) {
  const hits = best.get(p.id);
  if (!hits) continue;
  const top = Math.max(...hits.map((h) => h.score));
  const winners = hits.filter((h) => h.score === top);
  if (winners.length > 1) ambiguous.push({ product: p, hits: winners });
  else assigned.push({ product: p, row: winners[0].row, how: winners[0].how });
}

const matchedArticles = new Set(assigned.map((a) => a.row.article));
const toSet = assigned.filter((a) => a.product.isActive && a.row.photoUrl && (FORCE || !a.product.image));
const hasImage = assigned.filter((a) => a.product.isActive && a.product.image && !FORCE);
const noPhoto = assigned.filter((a) => a.product.isActive && !a.row.photoUrl);
const inactiveOnly = rows.filter((r) => !assigned.some((a) => a.row === r && a.product.isActive) && assigned.some((a) => a.row === r));
const future = rows.filter((r) => !matchedArticles.has(r.article));
const assignedIds = new Set(assigned.map((a) => a.product.id));
const orphans = eligible.filter((p) => p.isActive && !assignedIds.has(p.id));

console.log(`\nЗіставлено товарів: ${assigned.length} (рядків каталогу: ${matchedArticles.size})`);
console.log(`  поставити фото: ${toSet.length}`);
console.log(`  фото вже є (пропуск, --force замінить): ${hasImage.length}`);
console.log(`  рядок без фото в каталозі: ${noPhoto.length}`);
console.log(`  рядки, що збіглися лише з вимкненими картками: ${inactiveOnly.length}`);
console.log(`Неоднозначні (нічого не робимо): ${ambiguous.length}`);
console.log(`Рядків каталогу без товару в базі («майбутні»): ${future.length}`);
console.log(`Активних товарів Grösser поза каталогом: ${orphans.length}`);

const byHow = toSet.reduce<Record<string, number>>((acc, a) => ((acc[a.how] = (acc[a.how] ?? 0) + 1), acc), {});
console.log(`  за способом: ${JSON.stringify(byHow)}`);

console.log("\n── Поставимо фото ──");
for (const a of toSet) console.log(`  ${a.row.article} ${a.row.model.padEnd(28)} → [${a.how}] ${a.product.sku ?? "—"} | ${a.product.name.slice(0, 70)}`);
if (ambiguous.length) {
  console.log("\n── Неоднозначні ──");
  for (const x of ambiguous) console.log(`  ${x.product.sku} | ${x.product.name.slice(0, 60)} ← ${x.hits.map((h) => `${h.row.article} ${h.row.model}`).join(" / ")}`);
}
console.log("\n── Майбутні (в каталозі є, в базі нема) ──");
for (const r of future) console.log(`  ${r.article} ${r.model.padEnd(28)} ${r.kind.slice(0, 40).padEnd(40)} РРЦ ${r.rrcUah ?? "—"}`);
console.log("\n── Активні товари Grösser поза каталогом ──");
for (const p of orphans) console.log(`  ${(p.sku ?? "—").padEnd(20)} ${p.name.slice(0, 70)} | залишок ${p.stock}`);

const report = {
  catalogDate: index.catalogDate,
  at: new Date().toISOString(),
  apply: APPLY,
  set: toSet.map((a) => ({ productId: a.product.id, sku: a.product.sku, name: a.product.name, article: a.row.article, model: a.row.model, how: a.how, oldImage: a.product.image, newImage: a.row.photoUrl })),
  ambiguous: ambiguous.map((x) => ({ productId: x.product.id, sku: x.product.sku, name: x.product.name, rows: x.hits.map((h) => h.row.article) })),
  future: future.map((r) => ({ article: r.article, model: r.model, kind: r.kind, rrcUah: r.rrcUah, photoUrl: r.photoUrl })),
  orphans: orphans.map((p) => ({ productId: p.id, sku: p.sku, name: p.name, stock: p.stock })),
};
fs.mkdirSync("output/grosser-catalog", { recursive: true });
const reportPath = `output/grosser-catalog/sync-${new Date().toISOString().slice(0, 10)}${APPLY ? "-applied" : "-dry"}.json`;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 1));
console.log(`\nЗвіт: ${reportPath}`);

if (APPLY) {
  let done = 0;
  for (const a of toSet) {
    await prisma.product.update({ where: { id: a.product.id }, data: { image: a.row.photoUrl } });
    done++;
  }
  console.log(`Оновлено фото: ${done}`);
} else if (toSet.length) {
  console.log("Сухий прогін. Щоб застосувати: --apply");
}
await prisma.$disconnect();
