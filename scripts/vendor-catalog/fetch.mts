/**
 * Збір фото й характеристик товарів із сайту виробника.
 *
 * Рушій спільний для всіх джерел; чим саме відрізняється конкретний сайт —
 * описано в vendors.ts. Тут — обхід, ввічливість до чужого сервера,
 * відновлюваність і запобіжники.
 *
 * Головний запобіжник: беремо сторінку тільки тоді, коли вона САМА назвала
 * артикул і він збігся з нашим із 1С. Так фото не може приїхати від сусіднього
 * товару — на цьому свого часу сипався розбір каталогу APRO з PDF.
 *
 * Скрипт відновлюваний: розібрані сторінки лягають у pages.jsonl, завантажені
 * фото — у photos/, тож після обриву достатньо запустити ще раз.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/vendor-catalog/fetch.mts apro
 *   --out <тека>    куди складати (типово output/vendor-<slug>/<дата>)
 *   --instock       лише те, що є на складі
 *   --limit N       обмежити кількість сторінок (проба)
 *   --all           не лише товари без фото, а весь бренд (щоб оновити описи)
 *   --refresh       не брати розібрані сторінки з кешу
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { vendorBySlug, describe, normArticle, type Vendor, type Specs } from "./vendors";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : null);

const slug = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
if (!slug) throw new Error("вкажіть джерело: apro | sila | makita | polax | gradient");
const vendor = vendorBySlug(slug);
const DATE = new Date().toISOString().slice(0, 10);
const outdir = opt("out") ?? `output/vendor-${vendor.slug}/${DATE}`;
const INSTOCK = flag("instock");
const ALL = flag("all");
const REFRESH = flag("refresh");
const LIMIT = opt("limit") ? Number(opt("limit")) : Infinity;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CONCURRENCY = 4; // чужий сервер, не наш — ходимо стримано
const RETRIES = 2;

fs.mkdirSync(path.join(outdir, "photos"), { recursive: true });

/* ─────────────────────────── мережа ─────────────────────────── */

/**
 * Куки по хостах — як пари «ім'я → значення», а не як склеєний рядок.
 *
 * Перша версія просто дописувала кожен Set-Cookie в кінець, і на сайтах, які
 * оновлюють сесійну куку на КОЖНІЙ відповіді, заголовок Cookie ріс без меж:
 * через кількасот сторінок gradient.ua почав відповідати HTTP 431 («завеликі
 * заголовки») на все підряд, а apro.ua — просто відмовляти. Виглядало як бан,
 * хоча сайти були ні до чого.
 */
const jar = new Map<string, Map<string, string>>();

function remember(host: string, res: Response) {
  const sc = res.headers.getSetCookie?.() ?? [];
  if (!sc.length) return;
  const bag = jar.get(host) ?? new Map<string, string>();
  for (const raw of sc) {
    const [pair] = raw.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    bag.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  jar.set(host, bag);
}

const cookieHeader = (host: string) => {
  const bag = jar.get(host);
  if (!bag?.size) return undefined;
  return [...bag].map(([k, v]) => `${k}=${v}`).join("; ");
};

/**
 * `redirect: "manual"` навмисно: частина сайтів (sila.com.ua) відповідає
 * ланцюжком редиректів, який завершується лише коли клієнт носить куки, —
 * вбудований fetch без кук ходить по колу і падає на «redirect count exceeded».
 */
async function raw(url: string, referer?: string, hop = 0): Promise<Response> {
  if (hop > 8) throw new Error("забагато перенаправлень");
  const host = new URL(url).host;
  const cookie = cookieHeader(host);
  const res = await fetch(url, {
    headers: {
      "user-agent": UA,
      "accept-language": "uk-UA,uk;q=0.9,ru;q=0.8",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      ...(cookie ? { cookie } : {}),
      ...(referer ? { referer } : {}),
    },
    redirect: "manual",
    signal: AbortSignal.timeout(45_000),
  });
  remember(host, res);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (loc) return raw(new URL(loc, url).toString(), referer, hop + 1);
  }
  return res;
}

async function get(url: string, referer?: string): Promise<Response> {
  let last: unknown;
  for (let i = 0; i <= RETRIES; i++) {
    try {
      const res = await raw(url, referer);
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status}`);
      if (res.status === 404 || res.status === 410) break;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/**
 * Сторінка-заглушка з JS-перевіркою нічого не рахує: вона бере готове
 * значення з власного тексту, кладе його в куку й перезавантажується. Тому
 * достатньо це значення прочитати — браузер не потрібен.
 */
async function getPage(url: string, referer?: string): Promise<string> {
  let html = await (await get(url, referer)).text();
  if (vendor.challenge && html.includes("challenge_passed")) {
    const hash = html.match(/defaultHash\s*=\s*"([a-f0-9]{16,})"/i)?.[1];
    if (hash) {
      const host = new URL(url).host;
      const bag = jar.get(host) ?? new Map<string, string>();
      bag.set("challenge_passed", hash);
      jar.set(host, bag);
      html = await (await get(url, referer)).text();
    }
  }
  return html;
}

/* ─────────────────────── що нам потрібно ─────────────────────── */

const brands = await prisma.brand.findMany({ where: { slug: { in: vendor.brands } }, select: { id: true, slug: true, name: true } });
if (brands.length !== vendor.brands.length) {
  const have = brands.map((b) => b.slug);
  throw new Error(`не знайдено брендів: ${vendor.brands.filter((s) => !have.includes(s)).join(", ")}`);
}
const need = await prisma.product.findMany({
  where: {
    brandId: { in: brands.map((b) => b.id) },
    isActive: true,
    ...(ALL ? {} : { OR: [{ image: null }, { image: "" }] }),
    ...(INSTOCK ? { stock: { gt: 0 } } : {}),
  },
  select: { sku: true, name: true, stock: true },
});

/**
 * Артикули з 1С; «1C-…» — сурогат для позицій без артикулу, шукати нічим.
 *
 * Ключ — нормалізований артикул (див. normArticle), значення тримає СВІЙ,
 * непочіплений sku: саме за ним потім оновлюється картка в базі.
 */
const wanted = new Map<string, { sku: string; name: string; stock: number }>();
for (const p of need) {
  if (!p.sku || /^1C-/i.test(p.sku)) continue;
  if (vendor.ourProduct && !vendor.ourProduct(p.name)) continue;
  wanted.set(normArticle(p.sku), { sku: p.sku.trim(), name: p.name, stock: p.stock });
}
console.log(`Джерело: ${vendor.title} (${vendor.site})`);
console.log(`Бренди в базі: ${brands.map((b) => b.name).join(", ")}`);
console.log(`Шукаємо: ${wanted.size} артикулів${ALL ? "" : " без фото"}${INSTOCK ? ", лише в наявності" : ""} (з ${need.length} карток)`);

/* ───────────────────── які сторінки обходити ───────────────────── */

async function sitemapUrls(urls: string[], depth = 0): Promise<string[]> {
  const out: string[] = [];
  for (const u of urls) {
    let xml: string;
    try {
      xml = await (await get(u)).text();
    } catch (e) {
      console.log(`  ! карта ${u}: ${(e as Error).message}`);
      continue;
    }
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/^http:/, "https:"));
    if (/<sitemapindex/i.test(xml) && depth < 3) out.push(...(await sitemapUrls(locs.filter((l) => /\.xml/.test(l)), depth + 1)));
    else out.push(...locs);
  }
  return out;
}

/** Обхід категорій із пагінацією — для сайтів без XML-карти. */
async function crawlUrls(d: Extract<Vendor["discover"], { kind: "crawl" }>): Promise<string[]> {
  const seen = new Set<string>();
  const products = new Set<string>();
  const queue = [...d.roots];
  let visited = 0;
  while (queue.length && visited < (d.pages ?? 60) * d.roots.length) {
    const u = queue.shift()!;
    if (seen.has(u)) continue;
    seen.add(u);
    visited++;
    let html: string;
    try {
      html = await getPage(u);
    } catch {
      continue;
    }
    for (const m of html.matchAll(/href="(https:\/\/[^"#?]+(?:\?page=\d+)?)"/g)) {
      const link = m[1].replace(/\/$/, "");
      if (d.pageMatch.test(link)) products.add(link);
      else if (d.follow.test(link) && !seen.has(link)) queue.push(link);
    }
    if (visited % 20 === 0) console.log(`  обійдено сторінок каталогу: ${visited}, знайдено карток: ${products.size}`);
  }
  return [...products];
}

let pages: string[];
if (vendor.discover.kind === "direct") {
  // Пряма адреса будується з нормалізованого артикулу: у 1С трапляється
  // кирилична «А», якої на сайті виробника, звісно, немає.
  const direct = vendor.discover;
  const order = [...wanted.entries()].sort((a, b) => b[1].stock - a[1].stock);
  pages = order.map(([key]) => direct.url(key));
} else if (vendor.discover.kind === "sitemap") {
  console.log("Читаю карту сайту…");
  const all = await sitemapUrls(vendor.discover.urls);
  const pm = vendor.discover.pageMatch;
  pages = [...new Set(all.filter((u) => (pm ? pm.test(u) : true)))];
  console.log(`  адрес у карті: ${all.length}, схожих на картку товару: ${pages.length}`);
} else {
  console.log("Обхід категорій…");
  pages = await crawlUrls(vendor.discover);
  console.log(`  знайдено карток товару: ${pages.length}`);
}
pages = pages.slice(0, LIMIT === Infinity ? pages.length : LIMIT);

/* ───────────────────────── розбір сторінок ───────────────────────── */

type Parsed = { url: string; article: string | null; title: string; photo: string | null; specs: Specs; text: string | null };

const cacheFile = path.join(outdir, "pages.jsonl");
const cache = new Map<string, Parsed>();
if (!REFRESH && fs.existsSync(cacheFile)) {
  for (const line of fs.readFileSync(cacheFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const p = JSON.parse(line) as Parsed;
      cache.set(p.url, p);
    } catch { /* обірваний рядок після падіння — просто перечитаємо сторінку */ }
  }
  console.log(`Кеш розібраних сторінок: ${cache.size}`);
}
const cacheOut = fs.createWriteStream(cacheFile, { flags: "a" });

const title = (html: string) =>
  (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

type Row = {
  /** Наш артикул із 1С — саме за ним sync знаходить картку. */
  article: string;
  /** Як той самий артикул надрукований у виробника (буває інший регістр). */
  vendorArticle: string;
  size: null;
  title: string;
  page: number;
  photo: string;
  source: string;
  specs: Specs;
  /** Живий текст виробника, якщо сайт його друкує (у більшості — ні). */
  text: string | null;
  /** Готовий опис — довідково; sync складає його заново з specs. */
  description: string;
};
const rows: Row[] = [];
const failed: string[] = [];
let parsed = 0, hits = 0, downloaded = 0, cached = 0, noArticle = 0;

async function handle(url: string) {
  let p = cache.get(url);
  if (!p) {
    const html = await getPage(url, vendor.site);
    p = {
      url,
      article: vendor.article(html, url)?.trim() || null,
      title: title(html),
      photo: vendor.photo(html, url),
      specs: vendor.specs?.(html) ?? {},
      text: vendor.text?.(html) ?? null,
    };
    cacheOut.write(JSON.stringify(p) + "\n");
  } else cached++;
  parsed++;
  if (!p.article) { noArticle++; return; }
  const key = normArticle(p.article);
  const mine = wanted.get(key);
  if (!mine) return;
  hits++;
  if (!p.photo) { failed.push(`${p.article}: на сторінці немає фото`); return; }

  const ext = (p.photo.match(/\.(jpe?g|png|webp)(?:\?|$)/i)?.[1] ?? "jpg").toLowerCase().replace("jpeg", "jpg");
  // Ім'я файлу — з нормалізованого артикулу: кирилична «А» з 1С інакше
  // перетворилась би на «_» і файл став би нечитабельним.
  const rel = `photos/${key.replace(/[^\w.-]/g, "_")}.${ext}`;
  const dest = path.join(outdir, rel);
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000) {
    const buf = Buffer.from(await (await get(p.photo, url)).arrayBuffer());
    if (buf.length < 1000) { failed.push(`${p.article}: фото ${buf.length} б`); return; }
    fs.writeFileSync(dest, buf);
    downloaded++;
  }
  rows.push({
    article: mine.sku,
    vendorArticle: p.article,
    size: null,
    title: p.title,
    page: 0,
    photo: rel,
    source: url,
    specs: p.specs,
    text: p.text,
    description: describe(p.title, p.specs, p.text),
  });
}

let idx = 0;
async function worker() {
  while (idx < pages.length) {
    const url = pages[idx++];
    try {
      await handle(url);
    } catch (e) {
      const msg = (e as Error).message;
      // 404 на прямій адресі — нормально: такого артикулу в виробника просто нема
      if (!(vendor.discover.kind === "direct" && /HTTP 404/.test(msg))) failed.push(`${url}: ${msg}`);
      parsed++;
    }
    if (parsed % 100 === 0) console.log(`  ${parsed}/${pages.length} · збіглось ${hits} · нових фото ${downloaded} · помилок ${failed.length}`);
  }
}
console.log(`\nОбхід ${pages.length} сторінок, по ${CONCURRENCY} одночасно…`);
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
cacheOut.end();

/* ───────────────────────────── підсумок ───────────────────────────── */

const uniq = new Map<string, Row>();
for (const r of rows) if (!uniq.has(r.article)) uniq.set(r.article, r);
const final = [...uniq.values()];

fs.writeFileSync(
  path.join(outdir, "index.json"),
  JSON.stringify({ vendor: vendor.slug, brand: vendor.title, source: vendor.site, cover: null, groups: [], rows: final }, null, 1)
);

console.log(`\nРозібрано сторінок: ${parsed} (з кешу ${cached}), без артикулу ${noArticle}`);
console.log(`Збіглося з нашими артикулами: ${final.length} із ${wanted.size} шуканих`);
console.log(`  завантажено нових фото: ${downloaded}`);
console.log(`  з характеристиками: ${final.filter((r) => Object.keys(r.specs).length).length}`);
if (failed.length) {
  console.log(`Не вдалося: ${failed.length}`);
  for (const f of failed.slice(0, 15)) console.log("  " + f);
}
const found = new Set(final.map((r) => normArticle(r.article)));
const missed = [...wanted.values()].filter((w) => !found.has(normArticle(w.sku))).map((w) => w.sku);
console.log(`Не знайшлося на сайті: ${missed.length}${missed.length ? " — " + missed.slice(0, 20).join(", ") : ""}`);
console.log(`\nІндекс: ${outdir}/index.json`);
await prisma.$disconnect();
