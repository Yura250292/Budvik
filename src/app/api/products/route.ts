import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getBrandDiscounts, getWholesalePrice } from "@/lib/wholesale-pricing";
import { prisma } from "@/lib/prisma";
import { skuSearchConditions } from "@/lib/catalog/sku-search";

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
  if (search) {
    // Артикул окремою гілкою: «GR-30030» має знаходити свій товар, а не все,
    // де в назві трапилось «gr»
    const bySku = skuSearchConditions(search) ?? [];
    where.OR = [...bySku, { name: { contains: search, mode: "insensitive" } }];
  }

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

  // Опт рахуємо зі знижки по бренду, а не з поля wholesalePrice: 1С його не
  // передає, тож у базі там старі значення з магазину.
  const brandDiscounts = isWholesale ? await getBrandDiscounts() : null;
  const mappedProducts = products.map((p) => {
    const wholesale = brandDiscounts ? getWholesalePrice(p.price, p.name, brandDiscounts) : p.price;
    return { ...p, displayPrice: wholesale, hasWholesalePrice: isWholesale && wholesale < p.price };
  });

  return NextResponse.json({
    products: mappedProducts,
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
    isWholesale,
  });
}
