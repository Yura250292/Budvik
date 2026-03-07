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
      // Personalized recommendations based on order history
      const session = await getServerSession(authOptions);
      if (!session) {
        // Return popular products for anonymous users
        const products = await prisma.product.findMany({
          where: { isActive: true },
          include: { category: true },
          orderBy: { price: "desc" },
          take: 8,
        });
        return NextResponse.json({ products, type: "popular" });
      }

      // Get user's purchased categories
      const userOrders = await prisma.order.findMany({
        where: { userId: session.user.id },
        include: { items: { include: { product: true } } },
      });

      const purchasedIds = new Set<string>();
      const categoryIds = new Set<string>();
      for (const order of userOrders) {
        for (const item of order.items) {
          purchasedIds.add(item.productId);
          categoryIds.add(item.product.categoryId);
        }
      }

      if (categoryIds.size === 0) {
        const products = await prisma.product.findMany({
          where: { isActive: true },
          include: { category: true },
          orderBy: { price: "desc" },
          take: 8,
        });
        return NextResponse.json({ products, type: "popular" });
      }

      // Recommend from same categories but not yet purchased
      const products = await prisma.product.findMany({
        where: {
          isActive: true,
          categoryId: { in: Array.from(categoryIds) },
          id: { notIn: Array.from(purchasedIds) },
        },
        include: { category: true },
        take: 8,
      });

      return NextResponse.json({ products, type: "personal" });
    }

    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  } catch (error: unknown) {
    console.error("AI Recommend error:", error);
    return NextResponse.json({ error: "Помилка сервісу рекомендацій" }, { status: 500 });
  }
}
