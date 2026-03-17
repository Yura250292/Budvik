import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// All tool categories relevant for simulation
const SIMULATION_CATEGORY_SLUGS = [
  // Drills & perforators
  "dryli", "udarni-dryli", "perforatory", "pryami-perforatory", "bochkovi-perforatory",
  // Grinders (bolgarky) & sanders
  "kutovi-shlifmashyny-bolharky", "shlifuval-ni-mashyny",
  // Saws
  "tsyrkulyarni-pyly", "elektrolobzyky", "elektropyly",
  // Planers
  "elektrorubanky",
  // Chainsaws
  "benzopyly",
  // Battery-powered (specific tool types only)
  "akumulyatorni-shurupoverty", "akumulyatorni-perforatory",
  "akumulyatorni-bolharky-kshm", "akumulyatorni-tsyrkulyarni-pyly",
  "akumulyatorni-shlifuval-ni-mashynky", "akumulyatorni-lobzyky",
  "akumulyatorni-shabel-ni-pyly", "akumulyatorni-lantsyuhovi-pylky",
];

const TYPE_CATEGORY_MAP: Record<string, string[]> = {
  cutting: [
    "kutovi-shlifmashyny-bolharky", "tsyrkulyarni-pyly", "elektrolobzyky", "elektropyly",
    "benzopyly",
    "akumulyatorni-bolharky-kshm", "akumulyatorni-tsyrkulyarni-pyly",
    "akumulyatorni-lobzyky", "akumulyatorni-shabel-ni-pyly", "akumulyatorni-lantsyuhovi-pylky",
  ],
  grinding: [
    "kutovi-shlifmashyny-bolharky", "shlifuval-ni-mashyny", "elektrorubanky",
    "akumulyatorni-bolharky-kshm", "akumulyatorni-shlifuval-ni-mashynky",
  ],
  drilling: [
    "dryli", "udarni-dryli", "perforatory", "pryami-perforatory", "bochkovi-perforatory",
    "akumulyatorni-shurupoverty", "akumulyatorni-perforatory",
  ],
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
