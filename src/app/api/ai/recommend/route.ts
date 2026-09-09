import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { productRecommendations } from "@/lib/catalog/recommendations";

/**
 * Рекомендації для сторонніх викликів (застосунок, майбутні екрани).
 *
 * Вітрина цим роутом більше не користується: обидва блоки картки товару
 * збираються на сервері разом зі сторінкою. Логіка тут НЕ дублюється —
 * і `similar`, і `bought_together` кличуть ту саму
 * `productRecommendations`, інакше знову розійдуться.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("productId");
    const type = searchParams.get("type") || "similar"; // similar | bought_together | personal

    if ((type === "similar" || type === "bought_together") && productId) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: { category: { select: { name: true } } },
      });
      if (!product) return NextResponse.json({ products: [], type });

      const { boughtTogether, sameType } = await productRecommendations(product);
      // `similar` історично означало «схожі товари». Семантичного пошуку тут
      // більше немає (ProductEmbedding порожня, а перебір усіх векторів на
      // кожен запит коштує занадто дорого) — віддаємо той самий тип іншими
      // розмірами й виробниками, що й показує вітрина.
      return NextResponse.json({
        products: type === "similar" ? sameType : boughtTogether,
        type,
      });
    }

    if (type === "personal") {
      // Top-selling & most popular products the user hasn't ordered yet
      const session = await getServerSession(authOptions);

      // Exclude niche categories (верстати, etc.) — too specific for general recommendations
      const excludedCategorySlugs = ["1964", "1970", "1465", "1960", "1963", "1972"];
      const excludedCats = await prisma.category.findMany({
        where: { slug: { in: excludedCategorySlugs } },
        select: { id: true },
      });
      const excludedCatIds = excludedCats.map((c) => c.id);

      // Get top-selling products by order count
      const topSelling = await prisma.orderItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 50,
      });

      const topProductIds = topSelling.map((t) => t.productId);
      const purchasedIds = new Set<string>();

      if (session) {
        const userOrders = await prisma.order.findMany({
          where: { userId: session.user.id },
          include: { items: { select: { productId: true } } },
        });
        for (const order of userOrders) {
          for (const item of order.items) {
            purchasedIds.add(item.productId);
          }
        }
      }

      // Exclude products user already bought
      const filteredTopIds = topProductIds.filter((id) => !purchasedIds.has(id));

      let products = await prisma.product.findMany({
        where: {
          id: { in: filteredTopIds },
          isActive: true,
          stock: { gt: 0 },
          categoryId: { notIn: excludedCatIds },
          NOT: { name: { contains: "верстат" } },
        },
        include: { category: true },
      });

      // Sort by sales volume
      const salesMap = new Map(topSelling.map((t) => [t.productId, t._sum.quantity || 0]));
      products.sort((a, b) => (salesMap.get(b.id) || 0) - (salesMap.get(a.id) || 0));

      // If not enough top-sellers, fill with newest in-stock products
      if (products.length < 8) {
        const existingIds = new Set(products.map((p) => p.id));
        const excludeIds = [...existingIds, ...purchasedIds];
        const newest = await prisma.product.findMany({
          where: {
            isActive: true,
            stock: { gt: 0 },
            id: { notIn: excludeIds },
            categoryId: { notIn: excludedCatIds },
            NOT: { name: { contains: "верстат" } },
          },
          include: { category: true },
          orderBy: { createdAt: "desc" },
          take: 8 - products.length,
        });
        products = [...products, ...newest];
      }

      return NextResponse.json({ products: products.slice(0, 8), type: "popular" });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error: unknown) {
    console.error("AI Recommend error:", error);
    return NextResponse.json({ error: "Помилка сервісу рекомендацій" }, { status: 500 });
  }
}
