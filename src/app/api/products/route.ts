import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 24;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const search = searchParams.get("search");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));

  const where: any = { isActive: true };
  if (category) {
    // Support both slug and ID for category filtering
    where.category = category.length > 20 ? { id: category } : { slug: category };
  }
  if (search) where.name = { contains: search, mode: "insensitive" };

  const [products, total, session] = await Promise.all([
    prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: [{ stock: "desc" }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.product.count({ where }),
    getServerSession(authOptions),
  ]);

  const isWholesale = session?.user?.role === "WHOLESALE";

  const mappedProducts = products.map((p) => ({
    ...p,
    displayPrice: isWholesale && p.wholesalePrice ? p.wholesalePrice : p.price,
    hasWholesalePrice: isWholesale && p.wholesalePrice != null,
  }));

  return NextResponse.json({
    products: mappedProducts,
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
    isWholesale,
  });
}
