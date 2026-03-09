import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { semanticSearch } from "@/lib/ai/embeddings";

const STOP_WORDS = new Set([
  "для", "на", "по", "від", "до", "та", "і", "або", "з", "із", "що",
  "як", "яка", "який", "яке", "які", "це", "той", "ця", "ті",
  "в", "у", "не", "так", "ні", "бути", "мати", "можна",
  "надійний", "надійна", "надійну", "надійні",
  "хороший", "хороша", "хорошу", "хороші",
  "гарний", "гарна", "гарну", "гарні",
  "якісний", "якісна", "якісну", "якісні",
  "потужний", "потужна", "потужну", "потужні",
  "порекомендуй", "порекомендуйте", "порадь", "порадьте",
  "підкажи", "підкажіть", "покажи", "покажіть",
  "потрібно", "потрібен", "потрібна", "треба", "хочу",
  "дай", "дайте", "найкращий", "найкраща", "найкращі", "кращий", "краща",
  "топ", "кращі", "краще", "найкращі",
]);

// Synonyms for tool names
const SYNONYMS: Record<string, string[]> = {
  "болгарка": ["кшм", "кутова шліфмашина", "шліфмашина"],
  "болгарку": ["кшм", "кутова шліфмашина", "шліфмашина", "болгарка"],
  "болгарки": ["кшм", "кутова шліфмашина", "шліфмашина", "болгарка"],
  "кшм": ["болгарка", "кутова шліфмашина", "шліфмашина"],
  "дриль": ["дрель", "шуруповерт", "дриль-шуруповерт"],
  "дрель": ["дриль", "шуруповерт", "дриль-шуруповерт"],
  "шуруповерт": ["дриль-шуруповерт", "дриль"],
  "перфоратор": ["перф", "бурхаммер"],
  "лобзик": ["електролобзик"],
  "електролобзик": ["лобзик"],
  "пила": ["циркулярка", "циркулярна пила", "дискова пила"],
  "циркулярка": ["циркулярна пила", "дискова пила", "пила"],
  "фрезер": ["фрезерна машина"],
  "рубанок": ["електрорубанок"],
  "електрорубанок": ["рубанок"],
  "шліфмашина": ["шліфмашинка", "болгарка", "кшм"],
  "фен": ["технічний фен", "будівельний фен"],
  "компресор": ["компресор повітряний"],
  "генератор": ["електрогенератор", "бензогенератор"],
  "зварювальний": ["зварювальний апарат", "зварка", "інвертор"],
  "зварка": ["зварювальний апарат", "зварювальний", "інвертор"],
};

// Tool detection keywords
const TOOL_KEYWORDS = new Set([
  "болгарка", "болгарку", "болгарки", "кшм", "шліфмашина", "шліфмашину",
  "дриль", "дрель", "шуруповерт", "перфоратор",
  "лобзик", "електролобзик", "пила", "пилу", "циркулярка",
  "фрезер", "рубанок", "електрорубанок",
  "фен", "степлер", "краскопульт", "компресор", "генератор",
  "зварка", "зварювальний", "інвертор",
  "реноватор", "гайковерт", "міксер", "різак",
]);

// Tool category whitelist
const toolCategoryPatterns = /болгарк|кшм|шліфмашин|дрил|перфоратор|шуруповерт|лобзик|пил[аиі]|фрезер|рубанок|фен|зварюв|компресор|генератор|електроінструмент|гайковерт|реноватор|повітродув|тример|кущоріз|секатор|відбійн/i;

// Accessory indicators
const accessoryCategoryPatterns = /круг|диск|щітк|свердл|біт[іи\s]|насад|коронк|бур[иі\s]|патрон|зачис|відріз|витратн|ріжуч|плашк|мітчик|зубил|чаша/i;
const accessoryNamePatterns = /круг |диск |щітка|щітк[аи]|коронк|чаша |тримач кола|бур\s|свердл|полотн|ланцюг для|зірочка для|цанг|цанк|ролик для|фільтр для/i;

function isActualTool(catName: string, productName: string): boolean {
  const cat = catName.toLowerCase();
  const name = productName.toLowerCase();
  // FIRST check accessory — "Диски для болгарки" contains "болгарк" but is NOT a tool!
  if (accessoryCategoryPatterns.test(cat)) return false;
  if (accessoryNamePatterns.test(name)) return false;
  if (toolCategoryPatterns.test(cat)) return true;
  return false;
}

function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function expandWithSynonyms(keywords: string[]): string[] {
  const expanded = [...keywords];
  for (const kw of keywords) {
    const syns = SYNONYMS[kw];
    if (syns) expanded.push(...syns);
  }
  return [...new Set(expanded)];
}

// Minimum cosine similarity — raised to avoid irrelevant noise
const MIN_SIMILARITY = 0.65;

async function keywordSearch(query: string, limit = 16) {
  const keywords = extractKeywords(query);
  const userWantsTool = keywords.some((kw) => TOOL_KEYWORDS.has(kw));
  const expanded = expandWithSynonyms(keywords);

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

  if (exact.length >= 4 && !userWantsTool) return exact;

  if (expanded.length === 0) return exact;

  // Search each keyword (with synonyms) in name, description, AND category name
  const conditions = expanded.flatMap((kw) => [
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

    for (const kw of expanded) {
      let matched = false;
      if (nameL.includes(kw)) { score += 5; matched = true; }
      if (catL.includes(kw)) { score += 4; matched = true; }
      if (descL.includes(kw)) { score += 1; matched = true; }
      if (matched) matchedKeywords++;
    }

    // Bonus for matching ALL keywords (much more relevant)
    if (expanded.length > 1 && matchedKeywords === expanded.length) {
      score += 10;
    }

    // Tool/accessory scoring when user wants a tool
    const isTool = isActualTool(p.category?.name || "", p.name);
    if (userWantsTool) {
      if (isTool) {
        score += 30;
      } else {
        score -= 20;
      }
    }

    if (p.stock > 0) score += 3;
    return { product: p, score, matchedKeywords, isTool };
  });

  // When user wants a tool — separate and prioritize tools
  if (userWantsTool) {
    const tools = scored.filter((s) => s.isTool);
    const accessories = scored.filter((s) => !s.isTool);
    tools.sort((a, b) => b.score - a.score);
    accessories.sort((a, b) => b.score - a.score);

    const seen = new Set(exact.filter((p) => isActualTool(p.category?.name || "", p.name)).map((p) => p.id));
    const merged = exact.filter((p) => isActualTool(p.category?.name || "", p.name));

    for (const { product } of tools) {
      if (!seen.has(product.id)) {
        seen.add(product.id);
        merged.push(product);
      }
    }
    // Add max 3 accessories at the end
    let accCount = 0;
    for (const { product } of accessories) {
      if (accCount >= 3) break;
      if (!seen.has(product.id)) {
        seen.add(product.id);
        merged.push(product);
        accCount++;
      }
    }
    return merged.slice(0, limit);
  }

  // When query has multiple keywords, strongly prefer products matching ALL of them
  if (keywords.length > 1) {
    const allMatch = scored.filter((s) => s.matchedKeywords === expanded.length);
    const multiMatch = scored.filter((s) => s.matchedKeywords >= 2 && s.matchedKeywords < expanded.length);

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

        // If user wants a tool, boost tools in semantic results too
        const semKeywords = extractKeywords(query);
        const semUserWantsTool = semKeywords.some((kw) => TOOL_KEYWORDS.has(kw));

        const sorted = products.sort((a, b) => {
          let scoreA = scoreMap.get(a.id) || 0;
          let scoreB = scoreMap.get(b.id) || 0;
          if (semUserWantsTool) {
            if (isActualTool(a.category.name, a.name)) scoreA += 0.5;
            if (isActualTool(b.category.name, b.name)) scoreB += 0.5;
          }
          return scoreB - scoreA;
        });

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
