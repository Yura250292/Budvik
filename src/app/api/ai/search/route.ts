import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { semanticSearch } from "@/lib/ai/embeddings";

const STOP_WORDS = new Set([
  "для", "на", "по", "від", "до", "та", "і", "або", "з", "із", "що",
  "як", "яка", "який", "яке", "які", "це", "той", "ця", "ті",
  "в", "у", "не", "так", "ні", "бути", "мати", "можна",
]);

function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

async function keywordSearch(query: string, limit = 16) {
  // First try exact phrase match
  const exact = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
      ],
    },
    include: { category: true },
    take: limit,
  });

  if (exact.length >= 4) return exact;

  // Split into individual keywords and search each
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return exact;

  const conditions = keywords.flatMap((kw) => [
    { name: { contains: kw, mode: "insensitive" as const } },
    { description: { contains: kw, mode: "insensitive" as const } },
  ]);

  const all = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: conditions,
    },
    include: { category: true },
    take: 100,
  });

  // Score by number of keyword matches + stock priority
  const scored = all.map((p) => {
    let score = 0;
    const nameL = p.name.toLowerCase();
    const descL = (p.description || "").toLowerCase();
    for (const kw of keywords) {
      if (nameL.includes(kw)) score += 3;
      if (descL.includes(kw)) score += 1;
    }
    if (p.stock > 0) score += 5;
    return { product: p, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Merge with exact results (dedup)
  const seen = new Set(exact.map((p) => p.id));
  const merged = [...exact];
  for (const { product } of scored) {
    if (!seen.has(product.id)) {
      seen.add(product.id);
      merged.push(product);
    }
    if (merged.length >= limit) break;
  }

  return merged;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get("q");

  if (!query) {
    return NextResponse.json({ error: "Query parameter 'q' is required" }, { status: 400 });
  }

  // Try semantic search first
  try {
    const results = await semanticSearch(query, 16);

    if (results.length > 0) {
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

      if (sorted.length > 0) {
        return NextResponse.json({
          products: sorted,
          scores: Object.fromEntries(scoreMap),
          type: "semantic",
        });
      }
    }
  } catch (error) {
    console.error("Semantic search failed, falling back to keyword:", error);
  }

  // Fallback to smart keyword search
  try {
    const products = await keywordSearch(query);
    return NextResponse.json({ products, type: "keyword" });
  } catch (error) {
    console.error("Keyword search failed:", error);
    return NextResponse.json({ products: [], type: "error" });
  }
}
