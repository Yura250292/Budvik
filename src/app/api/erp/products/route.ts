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
    orderBy: [{ stock: "desc" }, { name: "asc" }],
    take: limit,
  });

  const result = products.map((p) => ({
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
    purchasePrice: p.supplierProducts[0]?.purchasePrice || 0,
  }));

  return NextResponse.json(result);
}
