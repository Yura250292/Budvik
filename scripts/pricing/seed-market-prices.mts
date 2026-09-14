/**
 * Перше наповнення ринкових цін — з обходів сайтів виробників.
 *
 * Обхід сайту цілком (карта сайту → тисячі сторінок) уже робили для фото:
 * у output/vendor-<джерело>/<дата>/pages.jsonl лежить, яка сторінка називає
 * який артикул. Звідси беремо адреси для наших товарів і читаємо на них ціну.
 * Далі воркер сам переперевіряє ці адреси щотижня (src/lib/pricing/market/
 * refresh.ts), а новим товарам адресу знайде наступний прогін цього скрипта
 * після свіжого обходу (scripts/vendor-catalog/fetch.mts <джерело> --all).
 *
 * Зіставлення — лише за артикулом, який сторінка назвала сама (так само, як для
 * фото), плюс перевірка схожості назв як запобіжник від чужого товару.
 *
 * Ціну вітрини скрипт не чіпає: перерахунок — scripts/pricing/reprice.mts.
 *
 *   npx tsx --env-file=.env scripts/pricing/seed-market-prices.mts                  # проба, усі джерела
 *   npx tsx --env-file=.env scripts/pricing/seed-market-prices.mts apro.ua --apply
 *   --instock    лише товари в наявності
 *   --limit N    не більше N сторінок на джерело
 *   --refresh    перечитати й ті, що перевірені менш ніж тиждень тому
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { normArticle, similarity, vendorBySlug } from "../vendor-catalog/vendors";
import { MARKET_SOURCES, type MarketSource } from "../../src/lib/pricing/market/sources";
import { fetchPage, HttpError } from "../../src/lib/pricing/market/http";
import type { MarketOffer } from "../../src/lib/pricing/market/extract";

const prisma = new PrismaClient();
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : null);
const APPLY = flag("apply");
const INSTOCK = flag("instock");
const REFRESH = flag("refresh");
const LIMIT = opt("limit") ? Number(opt("limit")) : Infinity;
const picked = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--limit");
const sources = picked.length ? MARKET_SOURCES.filter((s) => picked.includes(s.id)) : MARKET_SOURCES;

/** Нижче цього назви вже про різне: «Ключ торцевий» проти «Набір біт». */
const MIN_SIMILARITY = 0.15;
const CONCURRENCY = 2;
const PAUSE_MS = 400;
const FRESH_MS = 7 * 86_400_000;
/** Фільтр «це справді товар бренду» з реєстру фото, крім sigma.ua: там він пропускає лише ULTRA. */
const SKIP_VENDOR_FILTER = new Set(["sigma.ua"]);

const DATE = new Date().toISOString().slice(0, 10);
const OUT = `output/market-prices/${DATE}`;
fs.mkdirSync(OUT, { recursive: true });

type Page = { url: string; article: string; title: string };

function latestPages(vendorCache: string): { pages: Page[]; from: string | null } {
  const dir = `output/vendor-${vendorCache}`;
  if (!fs.existsSync(dir)) return { pages: [], from: null };
  const dates = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "pages.jsonl"))).sort();
  const last = dates.at(-1);
  if (!last) return { pages: [], from: null };
  const pages: Page[] = [];
  for (const line of fs.readFileSync(path.join(dir, last, "pages.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const p = JSON.parse(line);
      if (p.article) pages.push({ url: p.url, article: String(p.article), title: String(p.title ?? "") });
    } catch {
      /* обірваний рядок */
    }
  }
  return { pages, from: path.join(dir, last) };
}

/**
 * Запис із повтором. Публічний проксі Railway з офісної машини час від часу
 * не пускає з'єднання («Can't reach database server»), і без повтору губилися
 * б усі ціни, прочитані з сайту за пів години обходу.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

async function seed(source: MarketSource) {
  const vendor = vendorBySlug(source.vendorCache);
  const keyOf = vendor.key ?? normArticle;
  const { pages, from } = latestPages(source.vendorCache);

  const brands = await prisma.brand.findMany({ where: { slug: { in: source.brands } }, select: { id: true } });
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      brandId: { in: brands.map((b) => b.id) },
      sku: { not: null },
      wholesalePrice: { gt: 0 },
      ...(INSTOCK ? { stock: { gt: 0 } } : {}),
    },
    select: {
      id: true, sku: true, name: true, stock: true, wholesalePrice: true,
      brand: { select: { slug: true, name: true } },
      marketPrices: { where: { source: source.id }, select: { seenAt: true } },
    },
  });

  // Під один артикул у нас буває кілька карток (інструмент і набори з ним):
  // ціна сторінки — ціна самого інструмента, тож віддаємо її найкоротшій назві.
  type P = (typeof products)[number];
  const ours = new Map<string, P>();
  const byModel: P[] = [];
  for (const p of products) {
    if (source.modelBrands?.includes(p.brand?.slug ?? "")) {
      byModel.push(p);
      continue;
    }
    if (/^1C-/i.test(p.sku!)) continue;
    if (!SKIP_VENDOR_FILTER.has(source.id) && vendor.ourProduct && !vendor.ourProduct(p.name)) continue;
    const key = keyOf(p.sku!.trim());
    const prev = ours.get(key);
    if (!prev || p.name.length < prev.name.length) ours.set(key, p);
  }

  const byKey = new Map<string, Page[]>();
  for (const pg of pages) {
    const key = keyOf(pg.article);
    byKey.set(key, [...(byKey.get(key) ?? []), pg]);
  }

  type Task = { product: P; page: Page; sim: number };
  const tasks: Task[] = [];
  let weak = 0;
  let fresh = 0;

  // Модель — артикул без хвоста-коду імпортера: «GB 208PL EXPERT g0346» → «GB 208PL EXPERT».
  // Шукаємо лише серед сторінок, що самі називають марку, і лише цілим словом:
  // «GCD 520» не повинна знайти сторінку «GCD 520T».
  // normArticle спершу: у 1С модель місцями набрана кирилицею («GCD 600Т»), і без
  // заміни «Т» просто зникала — картка шукала «GCD 600» і знаходила іншу модель.
  const norm = (s: string) => normArticle(s).replace(/Ö/g, "O").replace(/[^A-Z0-9]+/g, " ").trim();
  // Каркас і комплект — різні товари під однією моделлю: «GCS 601» з акумулятором
  // знаходив сторінку «GCS 601 (каркас)» за 394 ₴ при опті 776 ₴.
  const bare = (s: string) => /каркас|karkas|без\s*(акб|акум)|bez-akb/i.test(s);
  const pairs: [string, P][] = [...ours];
  const candidatesFor = new Map<P, Page[]>();
  for (const product of byModel) {
    const model = norm((product.sku ?? "").replace(/\bg\d{4}\b/i, "").replace(/каркас|karkas/gi, ""));
    if (model.length < 4 || !/\d/.test(model)) continue;
    const re = new RegExp(`(^| )${model.replace(/ /g, " ?")}( |$)`);
    const brandWord = norm(product.brand?.name ?? "");
    const found = pages.filter((pg) => {
      const t = norm(pg.title);
      return (
        (!brandWord || t.includes(brandWord)) &&
        re.test(t) &&
        bare(`${pg.title} ${pg.url}`) === bare(`${product.name} ${product.sku}`)
      );
    });
    if (found.length) {
      pairs.push([`model:${model}`, product]);
      candidatesFor.set(product, found);
    }
  }

  for (const [key, product] of pairs) {
    const candidates = candidatesFor.get(product) ?? byKey.get(key);
    if (!candidates) continue;
    const best = candidates
      .map((page) => ({ page, sim: similarity(product.name, page.title) }))
      .sort((a, b) => b.sim - a.sim)[0];
    if (best.sim < MIN_SIMILARITY) {
      weak++;
      continue;
    }
    const seen = product.marketPrices[0]?.seenAt;
    if (!REFRESH && seen && Date.now() - seen.getTime() < FRESH_MS) {
      fresh++;
      continue;
    }
    tasks.push({ product, ...best });
  }

  const queue = tasks.slice(0, LIMIT);
  const found: (Task & { offer: MarketOffer })[] = [];
  const failed: (Task & { error: string })[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < queue.length) {
        const task = queue[next++];
        try {
          const html = await fetchPage(task.page.url, { challenge: source.challenge });
          const offer = source.extract(html);
          if (offer) found.push({ ...task, offer });
          else failed.push({ ...task, error: "ціни на сторінці немає" });
        } catch (e) {
          failed.push({ ...task, error: e instanceof HttpError ? `HTTP ${e.status}` : String((e as Error).message).slice(0, 80) });
        }
        await new Promise((r) => setTimeout(r, PAUSE_MS));
      }
    })
  );

  if (APPLY) {
    const now = new Date();
    for (const f of found) {
      await withRetry(() => prisma.marketPrice.upsert({
        where: { productId_source: { productId: f.product.id, source: source.id } },
        create: {
          productId: f.product.id, source: source.id, url: f.page.url, price: f.offer.price,
          inStock: f.offer.inStock, title: f.page.title || null, foundBy: "vendor_crawl",
          lastStatus: f.offer.inStock === false ? "out_of_stock" : "ok", seenAt: now, checkedAt: now, changedAt: now,
        },
        update: {
          url: f.page.url, price: f.offer.price, inStock: f.offer.inStock, title: f.page.title || null, foundBy: "vendor_crawl",
          lastStatus: f.offer.inStock === false ? "out_of_stock" : "ok", seenAt: now, checkedAt: now, failCount: 0,
        },
      }));
    }
  }

  const ratios = found.map((f) => f.offer.price / f.product.wholesalePrice!);
  fs.writeFileSync(
    path.join(OUT, `${source.id}.json`),
    JSON.stringify(
      {
        source: source.id, cache: from, pages: pages.length, ours: ours.size + byModel.length, weak, fresh,
        found: found.map((f) => ({ sku: f.product.sku, name: f.product.name, stock: f.product.stock, wholesale: f.product.wholesalePrice, market: f.offer.price, ratio: Math.round((f.offer.price / f.product.wholesalePrice!) * 100) / 100, sim: Math.round(f.sim * 100) / 100, url: f.page.url })),
        failed: failed.map((f) => ({ sku: f.product.sku, url: f.page.url, error: f.error })),
      },
      null,
      1
    )
  );

  return {
    source: source.id,
    pages: pages.length,
    ours: ours.size + byModel.length,
    matched: tasks.length + fresh,
    weak,
    fetched: queue.length,
    prices: found.length,
    failed: failed.length,
    medianMarketToOpt: median(ratios),
    below125: ratios.filter((r) => r < 1.25).length,
    within: ratios.filter((r) => r >= 1.25 && r < 1.3).length,
    above130: ratios.filter((r) => r >= 1.3).length,
  };
}

const summary = await Promise.all(sources.map((s) => seed(s).catch((e) => ({ source: s.id, error: String(e) }))));
console.table(summary);
console.log(APPLY ? `Записано в MarketPrice. Звіти: ${OUT}` : `Проба — нічого не записано (--apply). Звіти: ${OUT}`);
await prisma.$disconnect();
