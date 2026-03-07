import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';

const prisma = new PrismaClient();

function normalize(s) {
  return s.toLowerCase().replace(/[^а-яіїєґa-z0-9]/g, '').trim();
}

async function main() {
  const sitemapData = JSON.parse(readFileSync('scripts/sitemap-products.json', 'utf-8'));

  // Build lookup maps from sitemap
  const sitemapByName = new Map();
  const sitemapBySku = new Map();
  for (const sp of sitemapData) {
    if (sp.imageUrl) {
      if (sp.name) sitemapByName.set(normalize(sp.name), sp);
      if (sp.sku) sitemapBySku.set(sp.sku, sp);
    }
  }

  // Get all DB products without images
  const products = await prisma.product.findMany({
    select: { id: true, name: true, sku: true },
    where: { image: null }
  });

  console.log(`DB products without image: ${products.length}`);
  console.log(`Sitemap products with images: ${sitemapByName.size} (by name), ${sitemapBySku.size} (by SKU)`);

  let updated = 0;
  let skuMatched = 0;
  let nameMatched = 0;
  const batchSize = 500;

  // Collect all updates first
  const updates = [];

  for (const p of products) {
    let imageUrl = null;

    // Try SKU match first
    if (p.sku && sitemapBySku.has(p.sku)) {
      imageUrl = sitemapBySku.get(p.sku).imageUrl;
      skuMatched++;
    }
    // Then try name match
    if (!imageUrl) {
      const norm = normalize(p.name);
      if (sitemapByName.has(norm)) {
        imageUrl = sitemapByName.get(norm).imageUrl;
        nameMatched++;
      }
    }

    if (imageUrl) {
      updates.push({ id: p.id, imageUrl });
    }
  }

  console.log(`\nMatches found: ${updates.length} (${skuMatched} by SKU, ${nameMatched} by name)`);
  console.log(`Updating database...`);

  // Execute updates in batches using transactions
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    await prisma.$transaction(
      batch.map(u => prisma.product.update({
        where: { id: u.id },
        data: { image: u.imageUrl }
      }))
    );
    const progress = Math.min(i + batchSize, updates.length);
    console.log(`  Updated ${progress}/${updates.length}`);
  }

  console.log(`\nDone! Updated ${updates.length} products with images.`);

  // Stats
  const totalWithImage = await prisma.product.count({ where: { image: { not: null } } });
  const total = await prisma.product.count();
  console.log(`Total products: ${total}, with image: ${totalWithImage} (${Math.round(totalWithImage/total*100)}%)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
