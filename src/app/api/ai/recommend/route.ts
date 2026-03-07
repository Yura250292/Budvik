import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findSimilarProducts } from "@/lib/ai/embeddings";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const productId = searchParams.get("productId");
    const type = searchParams.get("type") || "similar"; // similar | bought_together | personal

    if (type === "similar" && productId) {
      // Find semantically similar products
      const similar = await findSimilarProducts(productId, 6);
      const products = await prisma.product.findMany({
        where: { id: { in: similar.map((s) => s.productId) }, isActive: true },
        include: { category: true },
      });
      const scoreMap = new Map(similar.map((s) => [s.productId, s.score]));
      products.sort((a, b) => (scoreMap.get(b.id) || 0) - (scoreMap.get(a.id) || 0));
      return NextResponse.json({ products, type: "similar" });
    }

    if (type === "bought_together" && productId) {
      // Find products frequently bought together via order history
      const ordersWithProduct = await prisma.orderItem.findMany({
        where: { productId },
        select: { orderId: true },
      });
      const orderIds = ordersWithProduct.map((o) => o.orderId);

      if (orderIds.length === 0) {
        // Fallback to category-based
        const product = await prisma.product.findUnique({ where: { id: productId } });
        if (!product) return NextResponse.json({ products: [], type: "bought_together" });

        const products = await prisma.product.findMany({
          where: { categoryId: product.categoryId, id: { not: productId }, isActive: true },
          include: { category: true },
          take: 4,
        });
        return NextResponse.json({ products, type: "bought_together" });
      }

      const coItems = await prisma.orderItem.findMany({
        where: { orderId: { in: orderIds }, productId: { not: productId } },
        include: { product: { include: { category: true } } },
      });

      // Count co-occurrences
      const counts: Record<string, { product: typeof coItems[0]["product"]; count: number }> = {};
      for (const item of coItems) {
        if (!item.product.isActive) continue;
        if (!counts[item.productId]) {
          counts[item.productId] = { product: item.product, count: 0 };
        }
        counts[item.productId].count++;
      }

      const sorted = Object.values(counts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

      return NextResponse.json({
        products: sorted.map((s) => s.product),
        type: "bought_together",
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
          NOT: { name: { contains: "верстат", mode: "insensitive" } },
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
            NOT: { name: { contains: "верстат", mode: "insensitive" } },
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
