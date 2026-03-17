import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Map consumable mode to category slugs
const MODE_CATEGORY_MAP: Record<string, string[]> = {
  cutting_discs: [
    "kruhy", "kruhy-vidrizni-po-metalu", "dysky-dlya-bolharky-vidrizni-kruhy",
    "kruhy-vidrizni-abrazyvni", "kruhy-vidrizni-almazni", "kruhy-almazni",
  ],
  grinding_discs: [
    "kruhy-zachysni", "pelyustkovi-kruhy",
    "kruhy-zachysni-z-netkanoho-abrazyvu-koral", "kruhy-po-metalu",
  ],
  drill_bits: [
    "sverdla", "sverdla-po-betonu", "sverdla-po-metalu",
    "sverla-po-derevu", "sverla-perovi", "bury-po-betonu",
    "sverdla-po-metalu-skhidchasti", "sverla-po-derevu-spiral-ni",
    "nabory-sverdel-po-metalu", "nabory-sverl-po-derevu",
    "sverdla-dnipro-m", "sverdla-po-metalu-sigma", "sverdla-po-metalu-ultra",
    "sverla-dlya-skla-i-plytky", "sverla-trubchasti-z-almaznym-napylennyam",
    "sverla-perovi-po-derevu", "sverdla-po-derevu-dnipro-m",
  ],
  chainsaw: [
    "lantsyuhy-dlya-pyly", "benzopyly",
    "akumulyatorni-lantsyuhovi-pylky", "elektropyly",
  ],
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode");
  const search = searchParams.get("search");

  if (!mode || !MODE_CATEGORY_MAP[mode]) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
  }

  const slugs = MODE_CATEGORY_MAP[mode];

  const categories = await prisma.category.findMany({
    where: { slug: { in: slugs } },
    select: { id: true },
  });
  const categoryIds = categories.map((c) => c.id);

  if (categoryIds.length === 0) {
    return NextResponse.json([]);
  }

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      categoryId: { in: categoryIds },
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    },
    include: { category: true },
    orderBy: [{ stock: "desc" }, { name: "asc" }],
    take: 60,
  });

  return NextResponse.json(products);
}
