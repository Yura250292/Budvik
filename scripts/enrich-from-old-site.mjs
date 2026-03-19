#!/usr/bin/env node
/**
 * Enrich products with images and descriptions from the old budvik.com site.
 * FREE — no API costs, just scraping our own site.
 *
 * Strategy:
 * 1. Download all catalog sitemaps → get product URLs + image URLs
 * 2. Match products by name similarity (fuzzy match on slug/name)
 * 3. For matched products: save image from sitemap, fetch page for description
 *
 * Usage:
 *   node scripts/enrich-from-old-site.mjs [--limit N] [--offset N] [--dry-run]
 *   node scripts/enrich-from-old-site.mjs --images-only   # only images (fast, from sitemap)
 *   node scripts/enrich-from-old-site.mjs --desc-only     # only descriptions (slower, fetches pages)
 *   node scripts/enrich-from-old-site.mjs --parallel 5    # concurrent page fetches (default 3)
 */

import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

const CHALLENGE_COOKIE =
  "challenge_passed=1d9b2a525d0162e45fbcb6990a3c9215f80b3df86e90b30dbd2ffac31410ef00";
const BASE_URL = "https://budvik.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const IMAGES_ONLY = args.includes("--images-only");
const DESC_ONLY = args.includes("--desc-only");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 0; // 0 = all
const offsetIdx = args.indexOf("--offset");
const OFFSET = offsetIdx !== -1 ? parseInt(args[offsetIdx + 1], 10) : 0;
const parallelIdx = args.indexOf("--parallel");
const PARALLEL = parallelIdx !== -1 ? parseInt(args[parallelIdx + 1], 10) : 3;

async function main() {
  const mode = IMAGES_ONLY ? "images" : DESC_ONLY ? "descriptions" : "all";
  console.log(`\nЗбагачення з budvik.com | Режим: ${mode}`);
  console.log(`Dry run: ${DRY_RUN} | Parallel: ${PARALLEL}\n`);

  // Step 1: Get sitemap index
  console.log("1. Завантаження sitemap...");
  const sitemapUrls = await getSitemapIndex();
  console.log(`   Знайдено ${sitemapUrls.length} catalog sitemaps`);

  // Step 2: Parse all catalog sitemaps
  console.log("2. Парсинг товарів з sitemap...");
  const oldProducts = await parseAllSitemaps(sitemapUrls);
  console.log(`   Знайдено ${oldProducts.length} товарів на старому сайті\n`);

  // Step 3: Load our products that need enrichment
  console.log("3. Завантаження товарів з бази...");
  const where = {
    isActive: true,
    stock: { gt: 0 },
    NOT: [{ name: "Итог" }, { sku: { startsWith: "1C-D0660" } }],
  };

  if (IMAGES_ONLY) {
    where.OR = [{ image: null }, { image: "" }];
  } else if (DESC_ONLY) {
    where.description = "";
  } else {
    where.OR = [{ image: null }, { image: "" }, { description: "" }];
  }

  const dbProducts = await prisma.product.findMany({
    where,
    select: {
      id: true,
      name: true,
      sku: true,
      slug: true,
      stock: true,
      image: true,
      description: true,
    },
    orderBy: { stock: "desc" },
  });

  console.log(`   ${dbProducts.length} товарів потребують збагачення\n`);

  // Step 4: Match products
  console.log("4. Зіставлення товарів...");
  const matches = matchProducts(dbProducts, oldProducts);
  console.log(`   Знайдено ${matches.length} співпадінь\n`);

  // Apply limit/offset
  let toProcess = matches;
  if (OFFSET > 0) toProcess = toProcess.slice(OFFSET);
  if (LIMIT > 0) toProcess = toProcess.slice(0, LIMIT);

  console.log(`5. Обробка ${toProcess.length} товарів...\n`);

  let imgSaved = 0;
  let descSaved = 0;
  let descFailed = 0;

  // Phase A: Images from sitemap (fast, no page fetching needed)
  if (!DESC_ONLY) {
    const needImage = toProcess.filter((m) => !m.dbProduct.image && m.oldProduct.imageUrl);
    console.log(`--- Фото з sitemap: ${needImage.length} ---`);

    for (let i = 0; i < needImage.length; i++) {
      const { dbProduct, oldProduct } = needImage[i];
      const imgUrl = oldProduct.imageUrl;

      console.log(`  + ${i + 1}/${needImage.length} ${dbProduct.name}`);
      console.log(`    IMG: ${imgUrl}`);

      if (!DRY_RUN) {
        try {
          await prisma.product.update({
            where: { id: dbProduct.id },
            data: { image: imgUrl },
          });
          imgSaved++;
        } catch (e) {
          console.log(`    DB error: ${e.message}`);
        }
      } else {
        imgSaved++;
      }
    }
    console.log();
  }

  // Phase B: Descriptions from product pages (slower, need to fetch each page)
  if (!IMAGES_ONLY) {
    const needDesc = toProcess.filter((m) => !m.dbProduct.description);
    console.log(`--- Описи зі сторінок: ${needDesc.length} (паралельно по ${PARALLEL}) ---\n`);

    for (let i = 0; i < needDesc.length; i += PARALLEL) {
      const batch = needDesc.slice(i, i + PARALLEL);
      const results = await Promise.allSettled(
        batch.map(({ dbProduct, oldProduct }) =>
          fetchDescription(oldProduct.url).then((desc) => ({ dbProduct, desc }))
        )
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          const { dbProduct, desc } = result.value;
          if (desc && desc.length > 15) {
            const preview = desc.substring(0, 80).replace(/\n/g, " ");
            console.log(`  + ${dbProduct.name}`);
            console.log(`    ${preview}...`);

            if (!DRY_RUN) {
              try {
                await prisma.product.update({
                  where: { id: dbProduct.id },
                  data: { description: desc },
                });
                descSaved++;
              } catch (e) {
                console.log(`    DB error: ${e.message}`);
              }
            } else {
              descSaved++;
            }
          } else {
            descFailed++;
          }
        } else {
          descFailed++;
        }
      }

      const progress = Math.min(i + PARALLEL, needDesc.length);
      if (progress % 50 === 0 || progress === needDesc.length) {
        console.log(`  ... ${progress}/${needDesc.length}`);
      }

      // Small delay to not overwhelm the server
      if (i + PARALLEL < needDesc.length) await sleep(500);
    }
    console.log();
  }

  console.log(`\nРезультати${DRY_RUN ? " (dry run)" : ""}:`);
  if (!DESC_ONLY) console.log(`  Фото: ${imgSaved} збережено`);
  if (!IMAGES_ONLY) console.log(`  Описів: ${descSaved} збережено, ${descFailed} без опису на сайті`);

  await prisma.$disconnect();
}

// ============================================================
// SITEMAP PARSING
// ============================================================

async function fetchPage(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml",
      "Accept-Language": "uk-UA,uk;q=0.9",
      Cookie: CHALLENGE_COOKIE,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function getSitemapIndex() {
  const xml = await fetchPage(`${BASE_URL}/sitemap.xml`);
  const urls = [...xml.matchAll(/<loc>([^<]+catalog-sitemap[^<]+)<\/loc>/g)].map((m) => m[1]);
  return urls;
}

async function parseAllSitemaps(sitemapUrls) {
  const allProducts = [];

  for (const url of sitemapUrls) {
    try {
      const xml = await fetchPage(url);
      const products = parseSitemap(xml);
      allProducts.push(...products);
      console.log(`   ${url.split("/").pop()}: ${products.length} товарів`);
    } catch (e) {
      console.log(`   ${url.split("/").pop()}: помилка - ${e.message}`);
    }
  }

  return allProducts;
}

function parseSitemap(xml) {
  const products = [];
  // Split by <url> blocks
  const urlBlocks = xml.split("<url>").slice(1);

  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>([^<]+)<\/loc>/);
    if (!locMatch) continue;

    const url = locMatch[1];
    // Skip category pages (they don't have image:image typically or have different structure)
    const slug = url.replace(BASE_URL, "").replace(/^\/|\/$/g, "");
    if (!slug || slug.includes("/")) continue; // Category pages often have paths

    // Get first image
    const imageMatch = block.match(/<image:loc>([^<]+)<\/image:loc>/);
    const imageUrl = imageMatch ? imageMatch[1] : null;

    // Get title from image (contains product name with article)
    const titleMatch = block.match(/<image:title><!\[CDATA\[([^\]]+)\]\]><\/image:title>/);
    const title = titleMatch ? titleMatch[1].replace(/ фото.*$/, "").trim() : "";

    products.push({ url, slug, imageUrl, title });
  }

  return products;
}

// ============================================================
// PRODUCT MATCHING
// ============================================================

function matchProducts(dbProducts, oldProducts) {
  const matches = [];

  // Build lookup maps for old products
  // 1. By exact SKU in title
  const oldBySku = new Map();
  // 2. By normalized name
  const oldByNormalizedName = new Map();

  for (const old of oldProducts) {
    // Extract SKU from title (e.g. "Круг шліфувальний ... 65026-000 фото")
    const skuMatch = old.title.match(/(\d{5,}-\d{3}|\d{7,})/);
    if (skuMatch) {
      oldBySku.set(skuMatch[1], old);
    }

    const normName = normalizeName(old.title);
    if (normName) {
      oldByNormalizedName.set(normName, old);
    }
  }

  for (const dbProduct of dbProducts) {
    let matched = null;

    // Strategy 1: Match by SKU
    if (dbProduct.sku && !dbProduct.sku.startsWith("1C-")) {
      matched = oldBySku.get(dbProduct.sku);
    }

    // Strategy 2: Match by normalized name
    if (!matched) {
      const normName = normalizeName(dbProduct.name);
      matched = oldByNormalizedName.get(normName);
    }

    // Strategy 3: Fuzzy match by slug
    if (!matched) {
      const dbSlug = dbProduct.slug;
      matched = oldProducts.find((old) => {
        // Compare slugs with some tolerance
        return old.slug === dbSlug || slugSimilarity(old.slug, dbSlug) > 0.85;
      });
    }

    if (matched) {
      matches.push({ dbProduct, oldProduct: matched });
    }
  }

  return matches;
}

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/['"«»""]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[хx×]/g, "x") // normalize dimension separators
    .replace(/ø/gi, "")
    .replace(/\s*мм\.?\s*/g, "мм")
    .replace(/\s*м\.\s*/g, "м")
    .replace(/\bфото\b.*$/, "")
    .trim();
}

function slugSimilarity(a, b) {
  if (!a || !b) return 0;
  const partsA = a.split("-").filter(Boolean);
  const partsB = b.split("-").filter(Boolean);
  const setA = new Set(partsA);
  const setB = new Set(partsB);
  let common = 0;
  for (const p of setA) {
    if (setB.has(p)) common++;
  }
  return (2 * common) / (setA.size + setB.size);
}

// ============================================================
// DESCRIPTION FETCHING
// ============================================================

async function fetchDescription(url) {
  try {
    const html = await fetchPage(url);

    // Strategy 1: Product description div
    const descMatch = html.match(
      /<div[^>]*class="product-description[^"]*"[^>]*itemprop="description"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i
    );
    if (descMatch?.[1]) {
      const desc = cleanHtml(descMatch[1]);
      if (desc.length > 15) return desc;
    }

    // Strategy 2: og:description (usually shorter but better than nothing)
    const ogMatch = html.match(
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
    );
    if (ogMatch?.[1]) {
      let desc = decodeHtmlEntities(ogMatch[1]).trim();
      // Remove marketing prefix/suffix
      desc = desc
        .replace(/^.*?[】\]]\s*[—–-]\s*/, "")
        .replace(/✈.*$/, "")
        .replace(/✅.*$/, "")
        .replace(/☎.*$/, "")
        .trim();
      if (desc.length > 30) return desc;
    }

    // Strategy 3: Full product-description block (broader match)
    const broadMatch = html.match(
      /itemprop="description"[^>]*>([\s\S]*?)<\/div>/i
    );
    if (broadMatch?.[1]) {
      const desc = cleanHtml(broadMatch[1]);
      if (desc.length > 15) return desc;
    }

    return null;
  } catch {
    return null;
  }
}

function cleanHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<td[^>]*>/gi, " ")
    .replace(/<th[^>]*>/gi, " ")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
