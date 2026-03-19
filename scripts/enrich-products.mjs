#!/usr/bin/env node
/**
 * Enrich products with descriptions (Gemini, no grounding — cheap)
 * and images (direct scraping from UA shops — free).
 *
 * Descriptions: Gemini generates based on product name/SKU (~$2-3 for all 15k products)
 * Images: Scrapes Rozetka, Epicentr, Prom.ua by SKU/name search (free)
 *
 * Usage:
 *   node scripts/enrich-products.mjs [--limit N] [--offset N] [--dry-run]
 *   node scripts/enrich-products.mjs --desc-only     # only descriptions
 *   node scripts/enrich-products.mjs --images-only   # only images (scraping)
 *   node scripts/enrich-products.mjs --batch 20      # products per Gemini batch
 */

import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const IMAGES_ONLY = args.includes("--images-only");
const DESC_ONLY = args.includes("--desc-only");
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 100;
const offsetIdx = args.indexOf("--offset");
const OFFSET = offsetIdx !== -1 ? parseInt(args[offsetIdx + 1], 10) : 0;
const batchIdx = args.indexOf("--batch");
const BATCH_SIZE = batchIdx !== -1 ? parseInt(args[batchIdx + 1], 10) : 10;

const DELAY_MS = 1500;

// Ukrainian shop search URLs
const SHOPS = [
  {
    name: "rozetka",
    searchUrl: (q) => `https://rozetka.com.ua/search/?text=${encodeURIComponent(q)}`,
    productPattern: /href="(https:\/\/rozetka\.com\.ua\/[a-z0-9_-]+\/p\d+\/)"/gi,
  },
  {
    name: "epicentr",
    searchUrl: (q) => `https://epicentrk.ua/search/?q=${encodeURIComponent(q)}`,
    productPattern: /href="(https:\/\/epicentrk\.ua\/ua\/shop\/[^"]+\.html)"/gi,
  },
];

async function main() {
  if (!GEMINI_API_KEY && !IMAGES_ONLY) {
    console.error("GEMINI_API_KEY not set in .env");
    process.exit(1);
  }

  const mode = IMAGES_ONLY ? "images" : DESC_ONLY ? "descriptions" : "all";
  console.log(`\nЗбагачення товарів | Режим: ${mode}`);
  console.log(`Ліміт: ${LIMIT} | Offset: ${OFFSET} | Batch: ${BATCH_SIZE} | Dry run: ${DRY_RUN}\n`);

  // Build where clause
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

  const products = await prisma.product.findMany({
    where,
    select: {
      id: true,
      name: true,
      sku: true,
      stock: true,
      image: true,
      description: true,
      category: { select: { name: true } },
    },
    orderBy: { stock: "desc" },
    skip: OFFSET,
    take: LIMIT,
  });

  console.log(`Знайдено ${products.length} товарів\n`);
  if (products.length === 0) {
    console.log("Нічого для збагачення!");
    await prisma.$disconnect();
    return;
  }

  let descGenerated = 0;
  let imgFound = 0;
  let descFailed = 0;
  let imgFailed = 0;

  // --- DESCRIPTIONS (batched Gemini, no grounding) ---
  if (!IMAGES_ONLY) {
    const needDesc = products.filter((p) => !p.description);
    console.log(`--- Генерація описів: ${needDesc.length} товарів (батчами по ${BATCH_SIZE}) ---\n`);

    for (let i = 0; i < needDesc.length; i += BATCH_SIZE) {
      const batch = needDesc.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(needDesc.length / BATCH_SIZE);

      console.log(`  Батч ${batchNum}/${totalBatches} (${batch.length} товарів)...`);

      try {
        const descriptions = await generateDescriptionsBatch(batch);

        for (let j = 0; j < batch.length; j++) {
          const product = batch[j];
          const desc = descriptions[j];

          if (desc && desc.length > 15) {
            descGenerated++;
            const preview = desc.substring(0, 80).replace(/\n/g, " ");
            console.log(`    + ${product.name}`);
            console.log(`      ${preview}...`);

            if (!DRY_RUN) {
              try {
                await prisma.product.update({
                  where: { id: product.id },
                  data: { description: desc },
                });
              } catch (e) {
                console.log(`      DB error: ${e.message}`);
              }
            }
          } else {
            descFailed++;
            console.log(`    - ${product.name}`);
          }
        }
      } catch (e) {
        descFailed += batch.length;
        console.log(`    ! Помилка батчу: ${e.message}`);
      }

      if (i + BATCH_SIZE < needDesc.length) await sleep(DELAY_MS);
    }

    console.log();
  }

  // --- IMAGES (scraping from UA shops) ---
  if (!DESC_ONLY) {
    const needImage = products.filter((p) => !p.image);
    console.log(`--- Пошук фото: ${needImage.length} товарів ---\n`);

    for (let i = 0; i < needImage.length; i++) {
      const product = needImage[i];
      const idx = `${i + 1}/${needImage.length}`;

      try {
        const imageUrl = await findImageFromShops(product);

        if (imageUrl) {
          imgFound++;
          console.log(`  + ${idx} ${product.name}`);
          console.log(`    IMG: ${imageUrl}`);

          if (!DRY_RUN) {
            try {
              await prisma.product.update({
                where: { id: product.id },
                data: { image: imageUrl },
              });
            } catch (e) {
              console.log(`    DB error: ${e.message}`);
            }
          }
        } else {
          imgFailed++;
          console.log(`  - ${idx} ${product.name}`);
        }
      } catch (e) {
        imgFailed++;
        console.log(`  ! ${idx} ${product.name}: ${e.message}`);
      }

      if (i < needImage.length - 1) await sleep(800);
    }

    console.log();
  }

  console.log(`Результати${DRY_RUN ? " (dry run)" : ""}:`);
  if (!IMAGES_ONLY) console.log(`  Описів: ${descGenerated} згенеровано, ${descFailed} не вдалось`);
  if (!DESC_ONLY) console.log(`  Фото: ${imgFound} знайдено, ${imgFailed} не знайдено`);

  await prisma.$disconnect();
}

// ============================================================
// DESCRIPTIONS — Gemini without grounding (cheap!)
// ============================================================

async function generateDescriptionsBatch(products) {
  const productList = products
    .map((p, i) => {
      const sku = p.sku && !p.sku.startsWith("1C-") ? ` (артикул: ${p.sku})` : "";
      const cat = p.category?.name && p.category.name !== "Імпорт з 1С" ? ` [${p.category.name}]` : "";
      return `${i + 1}. ${p.name}${sku}${cat}`;
    })
    .join("\n");

  const prompt = `Ти — експерт з будівельних інструментів та матеріалів. Напиши короткий опис для кожного товару (2-4 речення). Опис повинен містити: призначення, основні характеристики з назви, матеріал/тип якщо зрозуміло. Пиши українською. Без маркетингових фраз, тільки факти.

Товари:
${productList}

Відповідай ТІЛЬКИ у форматі:
1. <опис>
2. <опис>
...`;

  const reqBody = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
    },
  };

  const res = await fetchWithRetry(GEMINI_URL, reqBody);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  // Parse numbered responses
  const descriptions = [];
  for (let i = 0; i < products.length; i++) {
    const num = i + 1;
    const nextNum = i + 2;
    // Match "N. description text" or "N) description text"
    const pattern = new RegExp(
      `^${num}[.):]\\s*(.+?)(?=^${nextNum}[.):]|\\Z)`,
      "ms"
    );
    const match = text.match(pattern);
    if (match?.[1]) {
      descriptions.push(cleanDescription(match[1].trim()));
    } else {
      descriptions.push(null);
    }
  }

  return descriptions;
}

function cleanDescription(text) {
  return text
    .replace(/\*\*/g, "")
    .replace(/\[.*?\]\(.*?\)/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ============================================================
// IMAGES — Scraping from Ukrainian shops (free!)
// ============================================================

async function findImageFromShops(product) {
  const sku = product.sku && !product.sku.startsWith("1C-") ? product.sku : null;
  const name = product.name;

  // Strategy 1: Search by SKU in shops
  if (sku) {
    for (const shop of SHOPS) {
      const imgUrl = await searchShopForImage(shop, sku);
      if (imgUrl) return imgUrl;
    }
  }

  // Strategy 2: Search by product name
  // Clean name for search: remove size specs that might confuse search
  const searchName = name
    .replace(/\s*\d+[xх×]\d+[xх×]?\d*\s*/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .substring(0, 80);

  for (const shop of SHOPS) {
    const imgUrl = await searchShopForImage(shop, searchName);
    if (imgUrl) return imgUrl;
  }

  return null;
}

async function searchShopForImage(shop, query) {
  try {
    const url = shop.searchUrl(query);
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "uk-UA,uk;q=0.9",
      },
    });

    if (!res.ok) return null;

    const html = await res.text();

    // Find first product link
    const matches = [...html.matchAll(shop.productPattern)];
    if (matches.length === 0) return null;

    // Visit first product page
    const productUrl = matches[0][1];
    return await extractImageFromPage(productUrl);
  } catch {
    return null;
  }
}

async function extractImageFromPage(url) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "uk-UA,uk;q=0.9",
      },
    });

    if (!res.ok) return null;

    const ct = res.headers.get("content-type") || "";
    if (ct.startsWith("image/")) return res.url;
    if (!ct.includes("text/html")) return null;

    const html = await res.text();

    // og:image
    const ogMatch =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch?.[1]) {
      const imgUrl = resolveUrl(ogMatch[1], res.url);
      if (await verifyImageUrl(imgUrl)) return imgUrl;
    }

    // JSON-LD
    const jsonLdMatches = html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    );
    for (const m of jsonLdMatches) {
      try {
        const ld = JSON.parse(m[1]);
        const product = ld["@type"] === "Product" ? ld : ld?.["@graph"]?.find((x) => x["@type"] === "Product");
        if (product?.image) {
          const img = typeof product.image === "string" ? product.image : product.image.url || product.image[0]?.url || product.image[0];
          if (img && typeof img === "string" && img.startsWith("http")) {
            if (await verifyImageUrl(img)) return img;
          }
        }
      } catch {}
    }

    return null;
  } catch {
    return null;
  }
}

function resolveUrl(url, base) {
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return new URL(url, base).href;
  return url;
}

async function verifyImageUrl(url) {
  if (!url || !url.startsWith("http")) return false;
  if (url.includes("placeholder") || url.includes("no-image") || url.includes("noimage")) return false;
  if (url.includes("/logo") || url.includes("/favicon")) return false;

  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const ct = res.headers.get("content-type") || "";
    const cl = parseInt(res.headers.get("content-length") || "0", 10);
    return res.ok && (ct.startsWith("image/") || ct.includes("octet-stream")) && (cl === 0 || cl > 1024);
  } catch {
    return false;
  }
}

async function fetchWithRetry(url, body, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const retryAfter = Math.min(parseInt(res.headers.get("retry-after") || "30", 10), 60);
      console.log(`  ... Rate limit, чекаю ${retryAfter}с...`);
      await sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini HTTP ${res.status}: ${errText.substring(0, 200)}`);
    }

    return res;
  }
  throw new Error("Gemini: exceeded retries");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
