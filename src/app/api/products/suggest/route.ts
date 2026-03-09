import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json([]);
  }

  const terms = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);

  if (terms.length === 0) {
    return NextResponse.json([]);
  }

  // Search products matching all terms in name or category
  const conditions = terms.map((term) => ({
    OR: [
      { name: { contains: term, mode: "insensitive" as const } },
      { category: { name: { contains: term, mode: "insensitive" as const } } },
    ],
  }));

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      AND: conditions,
    },
    select: {
      name: true,
      slug: true,
      price: true,
      image: true,
      stock: true,
      category: { select: { name: true } },
    },
    orderBy: [{ stock: "desc" }, { name: "asc" }],
    take: 8,
  });

  return NextResponse.json(products);
}
