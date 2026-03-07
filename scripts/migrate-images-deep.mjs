import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

const prisma = new PrismaClient();

function normalize(s) {
  return s.toLowerCase().replace(/[^а-яіїєґa-z0-9]/g, '').trim();
}

// Extract key tokens from product name for fuzzy matching
function getTokens(name) {
  return name.toLowerCase()
    .replace(/[''\"«»()×х\[\]]/g, ' ')
    .split(/[\s,;:\/\-\.]+/)
    .filter(t => t.length > 1)
    .filter(t => !['для', 'мм', 'шт', 'см', 'кг', 'шт', 'сила', 'apro', 'sigma', 'grad', 'з', 'та', 'на', 'від', 'до', 'або', 'при', 'по', 'із'].includes(t));
}

// Score how well two product names match (0-1)
function matchScore(dbName, sitemapName) {
  const dbTokens = getTokens(dbName);
  const smTokens = getTokens(sitemapName);
  if (dbTokens.length === 0 || smTokens.length === 0) return 0;

  let matches = 0;
  for (const t of dbTokens) {
    if (smTokens.some(st => st === t || st.includes(t) || t.includes(st))) {
      matches++;
    }
  }
  return matches / Math.max(dbTokens.length, smTokens.length);
}

// Try to extract model number from product name
function extractModel(name) {
  // Match patterns like "GBH 2-26", "DF333DWAE", "SBE 650", "TC-MX 1400-2 E"
  const modelPatterns = [
    /\b([A-Z]{2,}[\s-]?\d[\w\-\/]*(?:\s+\w+)?)\b/i,
    /\b(\d{4,}[A-Z]*)\b/,
  ];
  for (const pattern of modelPatterns) {
    const m = name.match(pattern);
    if (m) return m[1].toLowerCase().replace(/[\s\-]/g, '');
  }
  return null;
}

async function fetchProductImage(slug) {
  try {
    const url = `https://budvik.com/${slug}/`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const html = await res.text();
    // Find og:image or first product image
    const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
    if (ogMatch) return ogMatch[1];
    const imgMatch = html.match(/content\/images\/\d+\/[^"'\s]+/);
    if (imgMatch) return 'https://budvik.com/' + imgMatch[0];
    return null;
  } catch {
    return null;
  }
}

async function searchOnSite(productName) {
  // Try searching via sitemap slug patterns
  const model = extractModel(productName);
  if (!model) return null;

  // Search in sitemap data for model number
  const sitemapData = JSON.parse(readFileSync('scripts/sitemap-products.json', 'utf-8'));
  const modelNorm = model.replace(/[\s\-]/g, '');

  for (const sp of sitemapData) {
    if (!sp.imageUrl || !sp.name) continue;
    const spModel = extractModel(sp.name);
    if (spModel && spModel === modelNorm) {
      return sp.imageUrl;
    }
    // Also check if model appears in slug
    if (sp.slug && sp.slug.replace(/-/g, '').includes(modelNorm)) {
      return sp.imageUrl;
    }
  }
  return null;
}

async function main() {
  const sitemapData = JSON.parse(readFileSync('scripts/sitemap-products.json', 'utf-8'));

  // Build various lookup indexes
  const sitemapByNormName = new Map();
  const sitemapBySku = new Map();
  const sitemapAll = [];

  for (const sp of sitemapData) {
    if (!sp.imageUrl) continue;
    if (sp.name) sitemapByNormName.set(normalize(sp.name), sp);
    if (sp.sku) sitemapBySku.set(sp.sku, sp);
    sitemapAll.push(sp);
  }

  const products = await prisma.product.findMany({
    select: { id: true, name: true, sku: true },
    where: { image: null }
  });

  console.log(`Products without image: ${products.length}`);

  let updated = 0;
  let skippedSeeds = 0;
  const updates = [];
  const notFound = [];

  for (const p of products) {
    let imageUrl = null;
    let matchMethod = '';

    // 1. Exact normalized name match
    const norm = normalize(p.name);
    if (sitemapByNormName.has(norm)) {
      imageUrl = sitemapByNormName.get(norm).imageUrl;
      matchMethod = 'exact-name';
    }

    // 2. SKU match
    if (!imageUrl && p.sku && sitemapBySku.has(p.sku)) {
      imageUrl = sitemapBySku.get(p.sku).imageUrl;
      matchMethod = 'sku';
    }

    // 3. Fuzzy name match (score > 0.6)
    if (!imageUrl) {
      let bestScore = 0;
      let bestMatch = null;
      for (const sp of sitemapAll) {
        if (!sp.name) continue;
        const score = matchScore(p.name, sp.name);
        if (score > bestScore && score >= 0.6) {
          bestScore = score;
          bestMatch = sp;
        }
      }
      if (bestMatch) {
        imageUrl = bestMatch.imageUrl;
        matchMethod = `fuzzy(${bestScore.toFixed(2)}): "${bestMatch.name}"`;
      }
    }

    // 4. Model number search in sitemap
    if (!imageUrl) {
      imageUrl = await searchOnSite(p.name);
      if (imageUrl) matchMethod = 'model-search';
    }

    if (imageUrl) {
      updates.push({ id: p.id, imageUrl });
      console.log(`  MATCH [${matchMethod}]: ${p.name}`);
    } else {
      notFound.push(p.name);
    }
  }

  console.log(`\nMatches found: ${updates.length} / ${products.length}`);

  if (updates.length > 0) {
    console.log('Updating database...');
    const batchSize = 100;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      await prisma.$transaction(
        batch.map(u => prisma.product.update({
          where: { id: u.id },
          data: { image: u.imageUrl }
        }))
      );
    }
    console.log(`Updated ${updates.length} products.`);
  }

  if (notFound.length > 0) {
    console.log(`\nNot found (${notFound.length}):`);
    for (const n of notFound) console.log(`  - ${n}`);
  }

  const totalWithImage = await prisma.product.count({ where: { image: { not: null } } });
  const total = await prisma.product.count();
  console.log(`\nFinal: ${totalWithImage}/${total} products with images (${Math.round(totalWithImage/total*100)}%)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
