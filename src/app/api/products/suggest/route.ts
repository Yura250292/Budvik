import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { skuSearchConditions } from "@/lib/catalog/sku-search";
import { stemTerm, translitVariants } from "@/lib/catalog/normalize";
import { trigramSearchIds, reorderByIds } from "@/lib/catalog/fuzzy";

const LIMIT = 8;

/**
 * Службові рядки-групи з 1С активні, але без ціни й фото. У підказках вони
 * найшкідливіші: займають місця з восьми доступних, а натиснути на них
 * немає сенсу.
 */
const SHOWABLE = { isActive: true, price: { gt: 0 } } as const;

/** Поля, які малює рядок підказки. */
const SELECT = {
  id: true,
  name: true,
  slug: true,
  sku: true,
  price: true,
  image: true,
  stock: true,
  category: { select: { name: true } },
} as const;

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
    .filter((w) => w.length > 1)
    .map(stemTerm);


  /**
   * Артикул — перший і головний кандидат: якщо людина набирає «GR-30030»,
   * вона знає, що їй треба, і потрібен саме цей товар угорі списку.
   * Перевіряємо сирий запит, бо нормалізація нижче з'їдає дефіси.
   */
  const bySku = skuSearchConditions(q);
  const skuMatches = bySku
    ? await prisma.product.findMany({
        where: { ...SHOWABLE, OR: bySku },
        select: SELECT,
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
    where: { ...SHOWABLE, AND: nameConditions, slug: { notIn: skuSlugs } },
    select: SELECT,
    orderBy: [{ stock: "desc" }, { name: "asc" }],
    take: LIMIT - skuMatches.length,
  });

  if (skuMatches.length + nameMatches.length >= LIMIT) {
    return NextResponse.json([...skuMatches, ...nameMatches]);
  }

  // Fill remaining with category-only matches
  const nameIds = [...skuSlugs, ...nameMatches.map((p) => p.slug)];
  const remaining = LIMIT - skuMatches.length - nameMatches.length;
  const categoryMatches = await prisma.product.findMany({
    where: {
      ...SHOWABLE,
      AND: broadConditions,
      slug: { notIn: nameIds },
      NOT: { AND: nameConditions },
    },
    select: SELECT,
    orderBy: [{ stock: "desc" }, { name: "asc" }],
    take: remaining,
  });

  const found = [...skuMatches, ...nameMatches, ...categoryMatches];
  if (found.length > 0) return NextResponse.json(found);

  // Нічого не знайшлось — та сама драбина, що й у каталозі: інша розкладка,
  // потім схожість. Порожній список підказок людина читає як «такого немає».
  return NextResponse.json(await rescue(q));
}

async function rescue(q: string) {
  for (const variant of translitVariants(q)) {
    const byVariant = await prisma.product.findMany({
      where: { ...SHOWABLE, name: { contains: variant, mode: "insensitive" } },
      select: SELECT,
      orderBy: [{ stock: "desc" }, { name: "asc" }],
      take: LIMIT,
    });
    if (byVariant.length > 0) return byVariant;
  }

  const ids = await trigramSearchIds(q, LIMIT);
  if (ids.length === 0) return [];

  const items = await prisma.product.findMany({ where: { id: { in: ids } }, select: SELECT });
  return reorderByIds(items, ids);
}
