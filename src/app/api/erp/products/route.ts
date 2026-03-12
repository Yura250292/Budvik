import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * ERP product search — searches by name, SKU, and category.
 * Returns purchase prices from SupplierProduct for auto-fill.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim();
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);

  if (!search || search.length < 1) {
    return NextResponse.json([]);
  }

  // Split search into terms for multi-word matching
  const terms = search.split(/\s+/).filter((t) => t.length > 0);

  // Build OR conditions: each term must match name, SKU, or category
  const conditions = terms.map((term) => ({
    OR: [
      { name: { contains: term, mode: "insensitive" as const } },
      { sku: { contains: term, mode: "insensitive" as const } },
      { category: { name: { contains: term, mode: "insensitive" as const } } },
    ],
  }));

  // Fetch more than needed so we can re-rank by relevance
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      AND: conditions,
    },
    include: {
      category: { select: { id: true, name: true } },
      supplierProducts: {
        orderBy: { lastUpdated: "desc" },
        take: 1,
        select: { purchasePrice: true, supplierId: true },
      },
    },
    take: limit * 3,
  });

  // Score and rank results by relevance
  const searchLower = search.toLowerCase();
  const termsLower = terms.map((t) => t.toLowerCase());

  const scored = products.map((p) => {
    const nameLower = p.name.toLowerCase();
    const skuLower = (p.sku || "").toLowerCase();
    let score = 0;

    // Exact SKU match — highest priority
    if (skuLower === searchLower) score += 1000;
    // SKU starts with search
    else if (skuLower.startsWith(searchLower)) score += 500;
    // SKU contains search
    else if (skuLower.includes(searchLower)) score += 200;

    // Name starts with search phrase
    if (nameLower.startsWith(searchLower)) score += 400;

    // Check each term as a whole word in the name (word boundary match)
    for (const term of termsLower) {
      // Word boundary: term preceded by start/space and followed by end/space/punctuation
      const wordRegex = new RegExp(`(?:^|\\s|[("'])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$|[,.)'"!?])`, "i");
      if (wordRegex.test(nameLower)) {
        score += 100; // Exact word match in name
      } else if (nameLower.includes(term)) {
        score += 30; // Partial match (e.g. "молотковим" contains "молоток")
      }
    }

    // Bonus for having stock
    if (p.stock > 0) score += 10;

    return { product: p, score };
  });

  // Sort by score descending, then by name
  scored.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name));

  const result = scored.slice(0, limit).map(({ product: p }) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    slug: p.slug,
    price: p.price,
    wholesalePrice: p.wholesalePrice,
    stock: p.stock,
    image: p.image,
    category: p.category?.name || null,
    categoryId: p.category?.id || null,
    purchasePrice: p.supplierProducts[0]?.purchasePrice || p.wholesalePrice || 0,
  }));

  return NextResponse.json(result);
}
