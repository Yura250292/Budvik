import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const SIMULATION_CATEGORY_SLUGS = [
  "drili-ta-perforatory",
  "shlifuvalni-mashyny",
  "pylky-ta-lobzyky",
  "akumulyatornyy-instrument",
];

const TYPE_CATEGORY_MAP: Record<string, string[]> = {
  cutting: ["shlifuvalni-mashyny", "pylky-ta-lobzyky", "akumulyatornyy-instrument"],
  grinding: ["shlifuvalni-mashyny", "akumulyatornyy-instrument"],
  drilling: ["drili-ta-perforatory", "akumulyatornyy-instrument"],
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const search = searchParams.get("search");

  const categorySlugs = type && TYPE_CATEGORY_MAP[type]
    ? TYPE_CATEGORY_MAP[type]
    : SIMULATION_CATEGORY_SLUGS;

  const categories = await prisma.category.findMany({
    where: { slug: { in: categorySlugs } },
    select: { id: true },
  });
  const categoryIds = categories.map((c) => c.id);

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      categoryId: { in: categoryIds },
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    },
    include: { category: true },
    orderBy: [{ stock: "desc" }, { name: "asc" }],
    take: 50,
  });

  return NextResponse.json(products);
}
