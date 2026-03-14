import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const maxDuration = 300;

/**
 * Scrape product images from old budvik.com sitemaps.
 * Parses catalog-sitemap-01..11.xml, extracts image URLs,
 * matches products by slug similarity, and updates DB.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;
  const sitemapRange = body.sitemapRange || { from: 1, to: 11 };

  // 1. Load all products without images
  const productsNoImage = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [{ image: null }, { image: "" }],
    },
    select: { id: true, name: true, slug: true, sku: true },
  });

  if (productsNoImage.length === 0) {
    return NextResponse.json({ message: "All products have images", updated: 0 });
  }

  // Build lookup maps
  const bySlug = new Map<string, typeof productsNoImage[0][]>();
  const byName = new Map<string, typeof productsNoImage[0]>();

  for (const p of productsNoImage) {
    // Index by slug parts for fuzzy matching
    if (p.slug) {
      const key = normalizeSlug(p.slug);
      if (!bySlug.has(key)) bySlug.set(key, []);
      bySlug.get(key)!.push(p);
    }
    // Index by normalized name
    const nameKey = normalizeName(p.name);
    if (!byName.has(nameKey)) byName.set(nameKey, p);
  }

  // 2. Fetch and parse all sitemaps
  let updated = 0;
  let matched = 0;
  let skipped = 0;
  const matches: { productId: string; productName: string; imageUrl: string; matchType: string }[] = [];

  for (let i = sitemapRange.from; i <= sitemapRange.to; i++) {
    const num = String(i).padStart(2, "0");
    const sitemapUrl = `https://budvik.com/content/export/budvik.com/catalog-sitemap-${num}.xml`;

    try {
      const res = await fetch(sitemapUrl, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) continue;
      const xml = await res.text();

      // Parse entries from XML
      const entries = parseSitemapEntries(xml);

      for (const entry of entries) {
        if (!entry.imageUrl) continue;

        // Try to match by slug
        const oldSlug = extractSlugFromUrl(entry.loc);
        if (!oldSlug) continue;

        const normalizedOldSlug = normalizeSlug(oldSlug);

        // Direct slug match
        let product = bySlug.get(normalizedOldSlug)?.[0];
        let matchType = "slug-exact";

        // Try partial slug match
        if (!product) {
          for (const [key, products] of bySlug) {
            if (slugSimilarity(normalizedOldSlug, key) > 0.75) {
              product = products[0];
              matchType = "slug-similar";
              break;
            }
          }
        }

        // Try name match from image title
        if (!product && entry.imageTitle) {
          const titleName = normalizeName(entry.imageTitle.replace(/\s*фото\s*$/i, ""));
          product = byName.get(titleName);
          if (product) matchType = "name-exact";
        }

        if (!product) {
          skipped++;
          continue;
        }

        matched++;

        // Use the highest quality image (replace size in URL with 1000x1000)
        const imageUrl = entry.imageUrl.replace(/\/\d+x\d+[^/]*\//, "/1000x1000l80mc0/");

        matches.push({
          productId: product.id,
          productName: product.name,
          imageUrl,
          matchType,
        });

        // Remove from maps so we don't double-match
        if (product.slug) {
          const key = normalizeSlug(product.slug);
          const arr = bySlug.get(key);
          if (arr) {
            const idx = arr.findIndex((p) => p.id === product!.id);
            if (idx >= 0) arr.splice(idx, 1);
            if (arr.length === 0) bySlug.delete(key);
          }
        }
        const nameKey = normalizeName(product.name);
        byName.delete(nameKey);
      }
    } catch (e: any) {
      console.error(`Failed to parse sitemap ${i}:`, e.message);
    }
  }

  // 3. Update DB in batches
  if (!dryRun && matches.length > 0) {
    const batchSize = 50;
    for (let i = 0; i < matches.length; i += batchSize) {
      const batch = matches.slice(i, i + batchSize);
      await prisma.$transaction(
        batch.map((m) =>
          prisma.product.update({
            where: { id: m.productId },
            data: { image: m.imageUrl },
          })
        )
      );
      updated += batch.length;
    }
  }

  return NextResponse.json({
    dryRun,
    totalWithoutImages: productsNoImage.length,
    sitemapsProcessed: sitemapRange.to - sitemapRange.from + 1,
    matched,
    updated: dryRun ? 0 : updated,
    skipped,
    preview: matches.slice(0, 30),
  });
}

// --- Helpers ---

function parseSitemapEntries(xml: string): { loc: string; imageUrl: string; imageTitle: string }[] {
  const entries: { loc: string; imageUrl: string; imageTitle: string }[] = [];
  // Match each <url> block
  const urlRegex = /<url>([\s\S]*?)<\/url>/g;
  let urlMatch;

  while ((urlMatch = urlRegex.exec(xml)) !== null) {
    const block = urlMatch[1];

    // Extract loc
    const locMatch = block.match(/<loc>(.*?)<\/loc>/);
    if (!locMatch) continue;
    const loc = locMatch[1].trim();

    // Extract first image
    const imgLocMatch = block.match(/<image:loc>(.*?)<\/image:loc>/);
    const imgTitleMatch = block.match(/<image:title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/image:title>/);

    if (!imgLocMatch) continue;

    entries.push({
      loc,
      imageUrl: imgLocMatch[1].trim(),
      imageTitle: imgTitleMatch?.[1]?.trim() || "",
    });
  }

  return entries;
}

function extractSlugFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    return path.replace(/^\/|\/$/g, "") || null;
  } catch {
    return null;
  }
}

function normalizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[-_]+/g, "-")
    .replace(/[^a-z0-9а-яєіїґь-]/g, "")
    .trim();
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[«»""'']/g, "")
    .trim();
}

function slugSimilarity(a: string, b: string): number {
  const partsA = a.split("-").filter(Boolean);
  const partsB = b.split("-").filter(Boolean);
  if (partsA.length === 0 || partsB.length === 0) return 0;

  let matches = 0;
  const used = new Set<number>();

  for (const partA of partsA) {
    for (let j = 0; j < partsB.length; j++) {
      if (used.has(j)) continue;
      if (partA === partsB[j] || (partA.length > 3 && partsB[j].startsWith(partA)) || (partsB[j].length > 3 && partA.startsWith(partsB[j]))) {
        matches++;
        used.add(j);
        break;
      }
    }
  }

  const maxLen = Math.max(partsA.length, partsB.length);
  return matches / maxLen;
}
