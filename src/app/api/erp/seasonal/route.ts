import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentSeason, DEFAULT_SEASONAL_KEYWORDS, getSeasonLabel, getSeasonIcon, getSeasonColor } from "@/lib/seasonal";

/** GET — fetch active seasonal promos + auto-generated seasonal products */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const includeProducts = searchParams.get("products") === "true";
  const limit = Math.min(parseInt(searchParams.get("limit") || "8"), 24);

  const season = getCurrentSeason();

  // Fetch admin-created seasonal promos
  const promos = await prisma.seasonalPromo.findMany({
    where: {
      isActive: true,
      OR: [
        { season },
        { season: "custom", startDate: { lte: new Date() }, endDate: { gte: new Date() } },
      ],
    },
    orderBy: { sortOrder: "asc" },
  });

  let products: any[] = [];

  if (includeProducts) {
    if (promos.length > 0) {
      // Use admin promos to fetch products
      const allKeywords = promos.flatMap((p) => p.keywords);
      const allCategoryIds = promos.flatMap((p) => p.categoryIds);
      const allProductIds = promos.flatMap((p) => p.productIds);

      const conditions: any[] = [];
      if (allKeywords.length > 0) {
        conditions.push(...allKeywords.map((kw) => ({ name: { contains: kw, mode: "insensitive" as const } })));
      }
      if (allCategoryIds.length > 0) {
        conditions.push({ categoryId: { in: allCategoryIds } });
      }
      if (allProductIds.length > 0) {
        conditions.push({ id: { in: allProductIds } });
      }

      if (conditions.length > 0) {
        products = await prisma.product.findMany({
          where: {
            isActive: true,
            stock: { gt: 0 },
            AND: [{ image: { not: null } }, { NOT: { image: "" } }],
            OR: conditions,
          },
          include: { category: true },
          orderBy: [{ priority: "desc" }, { stock: "desc" }],
          take: limit,
        });
      }

      // Add manually pinned products that might not match keywords
      if (allProductIds.length > 0) {
        const pinnedIds = allProductIds.filter((id) => !products.some((p) => p.id === id));
        if (pinnedIds.length > 0) {
          const pinned = await prisma.product.findMany({
            where: { id: { in: pinnedIds }, isActive: true, AND: [{ image: { not: null } }, { NOT: { image: "" } }] },
            include: { category: true },
          });
          products = [...pinned, ...products].slice(0, limit);
        }
      }
    } else {
      // Auto-generate from default seasonal keywords
      const keywords = DEFAULT_SEASONAL_KEYWORDS[season];
      products = await prisma.product.findMany({
        where: {
          isActive: true,
          stock: { gt: 0 },
          price: { gte: 200 },
          AND: [{ image: { not: null } }, { NOT: { image: "" } }],
          OR: keywords.map((kw) => ({ name: { contains: kw, mode: "insensitive" as const } })),
        },
        include: { category: true },
        orderBy: [{ priority: "desc" }, { stock: "desc" }],
        take: limit,
      });
    }
  }

  return NextResponse.json({
    season,
    seasonLabel: getSeasonLabel(season),
    seasonIcon: getSeasonIcon(season),
    seasonColor: getSeasonColor(season),
    promos,
    products,
  });
}

/** POST — create/update seasonal promo (admin only) */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { id, title, description, season, icon, color, keywords, categoryIds, productIds, isActive, startDate, endDate, sortOrder } = body;

  if (id) {
    // Update
    const updated = await prisma.seasonalPromo.update({
      where: { id },
      data: {
        title, description, season, icon, color,
        keywords: keywords || [],
        categoryIds: categoryIds || [],
        productIds: productIds || [],
        isActive: isActive ?? true,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        sortOrder: sortOrder ?? 0,
      },
    });
    return NextResponse.json(updated);
  }

  // Create
  const created = await prisma.seasonalPromo.create({
    data: {
      title, description, season, icon, color,
      keywords: keywords || [],
      categoryIds: categoryIds || [],
      productIds: productIds || [],
      isActive: isActive ?? true,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      sortOrder: sortOrder ?? 0,
    },
  });

  return NextResponse.json(created);
}

/** DELETE — remove seasonal promo */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.seasonalPromo.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
