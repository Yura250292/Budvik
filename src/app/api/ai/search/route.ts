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
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

// Minimum cosine similarity — raised to avoid irrelevant noise
const MIN_SIMILARITY = 0.65;

async function keywordSearch(query: string, limit = 16) {
  const keywords = extractKeywords(query);

  // First try exact phrase match in name, description, AND category name
  const exact = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
        { category: { name: { contains: query, mode: "insensitive" } } },
      ],
    },
    include: { category: true },
    take: limit,
  });

  if (exact.length >= 4) return exact;

  if (keywords.length === 0) return exact;

  // Search each keyword in name, description, AND category name
  const conditions = keywords.flatMap((kw) => [
    { name: { contains: kw, mode: "insensitive" as const } },
    { description: { contains: kw, mode: "insensitive" as const } },
    { category: { name: { contains: kw, mode: "insensitive" as const } } },
  ]);

  const all = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: conditions,
    },
    include: { category: true },
    take: 200,
  });

  // Score by keyword matches: name > category > description, stock priority
  const scored = all.map((p) => {
    let score = 0;
    const nameL = p.name.toLowerCase();
    const descL = (p.description || "").toLowerCase();
    const catL = (p.category?.name || "").toLowerCase();
    let matchedKeywords = 0;

    for (const kw of keywords) {
      let matched = false;
      if (nameL.includes(kw)) { score += 5; matched = true; }
      if (catL.includes(kw)) { score += 4; matched = true; }
      if (descL.includes(kw)) { score += 1; matched = true; }
      if (matched) matchedKeywords++;
    }

    // Bonus for matching ALL keywords (much more relevant)
    if (keywords.length > 1 && matchedKeywords === keywords.length) {
      score += 10;
    }

    if (p.stock > 0) score += 3;
    return { product: p, score, matchedKeywords };
  });

  // When query has multiple keywords, strongly prefer products matching ALL of them
  if (keywords.length > 1) {
    const allMatch = scored.filter((s) => s.matchedKeywords === keywords.length);
    const multiMatch = scored.filter((s) => s.matchedKeywords >= 2 && s.matchedKeywords < keywords.length);

    // If we have products matching ALL keywords, return them first
    if (allMatch.length > 0) {
      allMatch.sort((a, b) => b.score - a.score);
      const seen = new Set(exact.map((p) => p.id));
      const merged = [...exact];
      for (const { product } of allMatch) {
        if (!seen.has(product.id)) {
          seen.add(product.id);
          merged.push(product);
        }
      }
      // Only add partial matches if we still need more results
      if (merged.length < limit) {
        multiMatch.sort((a, b) => b.score - a.score);
        for (const { product } of multiMatch) {
          if (!seen.has(product.id)) {
            seen.add(product.id);
            merged.push(product);
          }
          if (merged.length >= limit) break;
        }
      }
      return merged.slice(0, limit);
    }

    // No full match — use multi-match if available
    if (multiMatch.length > 0) {
      multiMatch.sort((a, b) => b.score - a.score);
      const seen = new Set(exact.map((p) => p.id));
      const merged = [...exact];
      for (const { product } of multiMatch) {
        if (!seen.has(product.id)) {
          seen.add(product.id);
          merged.push(product);
        }
        if (merged.length >= limit) break;
      }
      return merged;
    }
  }

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

  // 1. Try keyword search FIRST (fast, precise for specific queries)
  try {
    const kwProducts = await keywordSearch(query);
    if (kwProducts.length >= 3) {
      return NextResponse.json({ products: kwProducts, type: "keyword" });
    }
  } catch (error) {
    console.error("Keyword search failed:", error);
  }

  // 2. Fallback to semantic search (for natural language queries)
  try {
    const results = await semanticSearch(query, 24);

    if (results.length > 0) {
      const relevant = results.filter((r) => r.score >= MIN_SIMILARITY);

      if (relevant.length > 0) {
        const productIds = relevant.map((r) => r.productId);
        const products = await prisma.product.findMany({
          where: { id: { in: productIds }, isActive: true },
          include: { category: true },
        });

        const scoreMap = new Map<string, number>(relevant.map((r) => [r.productId, r.score]));
        const sorted = products.sort(
          (a, b) => (scoreMap.get(b.id) || 0) - (scoreMap.get(a.id) || 0)
        );

        if (sorted.length > 0) {
          return NextResponse.json({
            products: sorted.slice(0, 12),
            scores: Object.fromEntries(scoreMap),
            type: "semantic",
          });
        }
      }
    }
  } catch (error) {
    console.error("Semantic search failed:", error);
  }

  // 3. Last resort — return whatever keyword search found (even if < 3)
  try {
    const products = await keywordSearch(query);
    return NextResponse.json({ products, type: "keyword" });
  } catch {
    return NextResponse.json({ products: [], type: "error" });
  }
}
