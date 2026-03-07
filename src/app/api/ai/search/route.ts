import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { semanticSearch } from "@/lib/ai/embeddings";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");

    if (!query) {
      return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 });
    }

    // Try semantic search first
    const results = await semanticSearch(query, 12);

    if (results.length === 0) {
      // Fallback to basic text search
      const products = await prisma.product.findMany({
        where: {
          isActive: true,
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
          ],
        },
        include: { category: true },
        take: 12,
      });
      return NextResponse.json({ products, type: "keyword" });
    }

    const productIds = results.map((r) => r.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      include: { category: true },
    });

    // Preserve semantic ordering
    const scoreMap = new Map(results.map((r) => [r.productId, r.score]));
    const sorted = products.sort(
      (a, b) => (scoreMap.get(b.id) || 0) - (scoreMap.get(a.id) || 0)
    );

    return NextResponse.json({
      products: sorted,
      scores: Object.fromEntries(scoreMap),
      type: "semantic",
    });
  } catch (error: unknown) {
    console.error("AI Search error:", error);
    // Fallback to keyword search on error
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q") || "";
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
        ],
      },
      include: { category: true },
      take: 12,
    });
    return NextResponse.json({ products, type: "fallback" });
  }
}
