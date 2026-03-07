import { writeFileSync } from 'fs';

async function fetchSitemap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

function extractProducts(xml) {
  const products = [];
  // Match each <url> block
  const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];

  for (const block of urlBlocks) {
    const locMatch = block.match(/<loc>(.*?)<\/loc>/);
    const imgMatch = block.match(/<image:loc>(.*?)<\/image:loc>/);
    const titleMatch = block.match(/<image:title><!\[CDATA\[(.*?)\]\]><\/image:title>/);

    if (!locMatch) continue;

    const url = locMatch[1];
    const imageUrl = imgMatch ? imgMatch[1] : null;
    const imageTitle = titleMatch ? titleMatch[1] : null;

    // Extract product name and SKU from title (format: "Product Name SKU фото")
    let name = null;
    let sku = null;
    if (imageTitle) {
      const cleaned = imageTitle.replace(/\s*фото\s*$/, '').trim();
      // SKU is typically the last number/word
      const skuMatch = cleaned.match(/^(.*?)\s+(\d+)\s*$/);
      if (skuMatch) {
        name = skuMatch[1].trim();
        sku = skuMatch[2];
      } else {
        name = cleaned;
      }
    }

    // Also extract slug from URL
    const slugMatch = url.match(/budvik\.com\/(.+?)\/?$/);
    const slug = slugMatch ? slugMatch[1].replace(/\/$/, '') : null;

    products.push({ url, slug, name, sku, imageUrl });
  }

  return products;
}

async function main() {
  const allProducts = [];

  for (let i = 1; i <= 11; i++) {
    const num = String(i).padStart(2, '0');
    const url = `https://budvik.com/content/export/budvik.com/catalog-sitemap-${num}.xml`;
    console.log(`Fetching sitemap ${num}...`);
    try {
      const xml = await fetchSitemap(url);
      const products = extractProducts(xml);
      console.log(`  Found ${products.length} products`);
      allProducts.push(...products);
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    }
  }

  console.log(`\nTotal products from sitemaps: ${allProducts.length}`);
  console.log(`Products with images: ${allProducts.filter(p => p.imageUrl).length}`);
  console.log(`Products with SKU: ${allProducts.filter(p => p.sku).length}`);

  writeFileSync('scripts/sitemap-products.json', JSON.stringify(allProducts, null, 2));
  console.log('Saved to scripts/sitemap-products.json');
}

main().catch(console.error);
