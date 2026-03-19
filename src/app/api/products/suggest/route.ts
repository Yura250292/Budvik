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

  const select = {
    name: true,
    slug: true,
    price: true,
    image: true,
    stock: true,
    category: { select: { name: true } },
  } as const;

  // Name match condition: all terms in name
  const nameConditions = terms.map((term) => ({
    name: { contains: term, mode: "insensitive" as const },
  }));

  // Broader condition: all terms in name OR category
  const broadConditions = terms.map((term) => ({
    OR: [
      { name: { contains: term, mode: "insensitive" as const } },
      { category: { name: { contains: term, mode: "insensitive" as const } } },
    ],
  }));

  // First: products with search term in name (most relevant)
  const nameMatches = await prisma.product.findMany({
    where: { isActive: true, AND: nameConditions },
    select,
    orderBy: [{ stock: "desc" }, { name: "asc" }],
    take: 8,
  });

  if (nameMatches.length >= 8) {
    return NextResponse.json(nameMatches);
  }

  // Fill remaining with category-only matches
  const nameIds = nameMatches.map((p) => p.slug);
  const remaining = 8 - nameMatches.length;
  const categoryMatches = await prisma.product.findMany({
    where: {
      isActive: true,
      AND: broadConditions,
      slug: { notIn: nameIds },
      NOT: { AND: nameConditions },
    },
    select,
    orderBy: [{ stock: "desc" }, { name: "asc" }],
    take: remaining,
  });

  return NextResponse.json([...nameMatches, ...categoryMatches]);
}
