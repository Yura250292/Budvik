import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatWithGemini } from "@/lib/ai/gemini";

export const maxDuration = 60;

export interface PriceCheckResult {
  productId: string;
  productName: string;
  sku: string;
  ourPrice: number;
  ourCostPrice: number;
  competitors: {
    store: string;
    price: number;
    url: string;
    note?: string;
  }[];
  cheapestPrice: number | null;
  priceDiff: number | null; // negative = we're cheaper
  summary: string;
}

/**
 * POST /api/erp/price-check
 * Body: { productIds: string[] } — check specific products
 *   OR  { query: string } — search products by name/category then check
 *   OR  { categoryId: string, limit: number } — check products in category
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { productIds, query, categoryId, limit = 10 } = body;

  // Resolve which products to check
  let products: any[] = [];

  if (productIds && productIds.length > 0) {
    products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { category: { select: { name: true } } },
    });
  } else if (query) {
    products = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { sku: { contains: query, mode: "insensitive" } },
          { category: { name: { contains: query, mode: "insensitive" } } },
        ],
      },
      include: { category: { select: { name: true } } },
      orderBy: { stock: "desc" },
      take: Math.min(limit, 20),
    });
  } else if (categoryId) {
    products = await prisma.product.findMany({
      where: { categoryId, isActive: true },
      include: { category: { select: { name: true } } },
      orderBy: { stock: "desc" },
      take: Math.min(limit, 20),
    });
  }

  if (products.length === 0) {
    return NextResponse.json({ error: "Товарів не знайдено" }, { status: 400 });
  }

  // Process products in batches of 3 (to not overwhelm Gemini)
  const results: PriceCheckResult[] = [];
  const batchSize = 3;

  for (let i = 0; i < products.length; i += batchSize) {
    const batch = products.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((p) => checkProductPrice(p))
    );
    results.push(...batchResults);
  }

  return NextResponse.json({ results, total: results.length });
}

async function checkProductPrice(product: any): Promise<PriceCheckResult> {
  const productName = product.name;
  const sku = product.sku || "";
  const ourPrice = product.price || 0;
  const ourCostPrice = product.wholesalePrice || 0;
  const category = product.category?.name || "";

  const prompt = `Знайди ціну на товар "${productName}" (артикул: ${sku}, категорія: ${category}) в українських інтернет-магазинах.

Шукай на сайтах: rozetka.com.ua, epicentrk.ua, prom.ua, 130.com.ua, foxtrot.com.ua, allo.ua та інших українських магазинах.

Для кожного знайденого результату дай:
- Назву магазину
- Ціну в грн (тільки число)
- URL посилання на товар

ВАЖЛИВО: Відповідь ТІЛЬКИ у форматі JSON, без markdown, без пояснень:
{
  "competitors": [
    { "store": "Назва магазину", "price": 123.45, "url": "https://...", "note": "коротка примітка якщо є" }
  ],
  "summary": "Коротке резюме порівняння цін (1-2 речення)"
}

Якщо товар не знайдено — поверни пустий масив competitors і напиши про це в summary.
Не вигадуй ціни — шукай реальні актуальні пропозиції.`;

  try {
    const response = await chatWithGemini(
      [{ role: "user", parts: [{ text: prompt }] }],
      "Ти — асистент для моніторингу цін конкурентів в Україні. Шукай реальні ціни на товари в українських інтернет-магазинах. Відповідай тільки JSON.",
      { useGoogleSearch: true }
    );

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = response.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const data = JSON.parse(jsonStr);
    const competitors = (data.competitors || []).map((c: any) => ({
      store: c.store || "Невідомий",
      price: parseFloat(c.price) || 0,
      url: c.url || "",
      note: c.note || undefined,
    })).filter((c: any) => c.price > 0);

    const cheapestPrice = competitors.length > 0
      ? Math.min(...competitors.map((c: any) => c.price))
      : null;

    return {
      productId: product.id,
      productName,
      sku,
      ourPrice,
      ourCostPrice,
      competitors,
      cheapestPrice,
      priceDiff: cheapestPrice !== null ? ourPrice - cheapestPrice : null,
      summary: data.summary || "Не вдалось отримати резюме",
    };
  } catch (e: any) {
    return {
      productId: product.id,
      productName,
      sku,
      ourPrice,
      ourCostPrice,
      competitors: [],
      cheapestPrice: null,
      priceDiff: null,
      summary: `Помилка аналізу: ${e.message}`,
    };
  }
}
