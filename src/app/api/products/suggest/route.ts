import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { skuSearchConditions } from "@/lib/catalog/sku-search";

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

  const select = {
    name: true,
    slug: true,
    sku: true,
    price: true,
    image: true,
    stock: true,
    category: { select: { name: true } },
  } as const;

  /**
   * Артикул — перший і головний кандидат: якщо людина набирає «GR-30030»,
   * вона знає, що їй треба, і потрібен саме цей товар угорі списку.
   * Перевіряємо сирий запит, бо нормалізація нижче з'їдає дефіси.
   */
  const bySku = skuSearchConditions(q);
  const skuMatches = bySku
    ? await prisma.product.findMany({
        where: { isActive: true, OR: bySku },
        select,
        orderBy: [{ stock: "desc" }, { name: "asc" }],
        take: 8,
      })
    : [];

  if (skuMatches.length >= 8 || (skuMatches.length > 0 && terms.length === 0)) {
    return NextResponse.json(skuMatches);
  }

  if (terms.length === 0) {
    return NextResponse.json(skuMatches);
  }

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

  // Артикульні збіги вже зайняли місця вгорі — рештою добираємо по назві
  const skuSlugs = skuMatches.map((p) => p.slug);

  const nameMatches = await prisma.product.findMany({
    where: { isActive: true, AND: nameConditions, slug: { notIn: skuSlugs } },
    select,
    orderBy: [{ stock: "desc" }, { name: "asc" }],
    take: 8 - skuMatches.length,
  });

  if (skuMatches.length + nameMatches.length >= 8) {
    return NextResponse.json([...skuMatches, ...nameMatches]);
  }

  // Fill remaining with category-only matches
  const nameIds = [...skuSlugs, ...nameMatches.map((p) => p.slug)];
  const remaining = 8 - skuMatches.length - nameMatches.length;
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

  return NextResponse.json([...skuMatches, ...nameMatches, ...categoryMatches]);
}
