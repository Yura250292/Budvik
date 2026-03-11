import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

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
  searchLinks: { title: string; url: string }[];
  cheapestPrice: number | null;
  priceDiff: number | null;
  summary: string;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { productIds, query, categoryId, limit = 10 } = body;

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

async function callGeminiWithGrounding(prompt: string, systemInstruction: string) {
  const url = `${GEMINI_BASE_URL}/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    tools: [{ googleSearch: {} }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
    },
  };

  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    const retryAfter = Math.min(parseInt(res.headers.get("retry-after") || "35", 10), 40);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error: ${res.status} ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text || "";

  // Extract real URLs from grounding metadata
  const groundingMeta = candidate?.groundingMetadata;
  const groundingChunks = groundingMeta?.groundingChunks || [];
  const searchLinks: { title: string; url: string }[] = [];

  for (const chunk of groundingChunks) {
    if (chunk.web?.uri) {
      searchLinks.push({
        title: chunk.web.title || "",
        url: chunk.web.uri,
      });
    }
  }

  return { text, searchLinks };
}

async function checkProductPrice(product: any): Promise<PriceCheckResult> {
  const productName = product.name;
  const sku = product.sku || "";
  const ourPrice = product.price || 0;
  const ourCostPrice = product.wholesalePrice || 0;
  const category = product.category?.name || "";

  const searchQuery = sku && !sku.startsWith("1C-")
    ? `${productName} ${sku}`
    : productName;

  const prompt = `Знайди актуальну ціну на товар "${searchQuery}" купити в Україні ціна грн.

Мене цікавлять реальні ціни в інтернет-магазинах України прямо зараз.

Проаналізуй результати пошуку і для кожного магазину де знайшов ціну, дай:
- Точну назву магазину (наприклад: Rozetka, Епіцентр, Prom.ua, 130.com.ua, тощо)
- Ціну в гривнях (тільки число, без пробілів)
- Коротку примітку якщо є (наприклад: "знижка", "під замовлення")

Наша поточна ціна: ${ourPrice} грн.

ВАЖЛИВО: Відповідь ТІЛЬКИ у форматі JSON, без markdown:
{
  "competitors": [
    { "store": "Назва", "price": 123, "note": "" }
  ],
  "summary": "Коротке порівняння (1-2 речення). Вказуй де дешевше і на скільки."
}

Якщо не знайшов ціну — поверни пустий масив і напиши в summary.
НІКОЛИ не вигадуй ціни. Тільки те що реально знайшов у результатах пошуку.`;

  try {
    const { text, searchLinks } = await callGeminiWithGrounding(
      prompt,
      "Ти — аналітик цін для українського магазину інструментів. Шукай ТІЛЬКИ реальні актуальні ціни в українських інтернет-магазинах. Не вигадуй дані. Відповідай JSON."
    );

    // Parse JSON from response
    let jsonStr = text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    let competitors: any[] = [];
    let summary = "";

    try {
      const data = JSON.parse(jsonStr);
      summary = data.summary || "";
      competitors = (data.competitors || []).map((c: any) => {
        const storeName = (c.store || "").trim();
        // Find matching URL from grounding metadata
        const matchingLink = searchLinks.find((l) => {
          const domain = storeName.toLowerCase().replace(/\s/g, "").replace(/\./g, "");
          const linkDomain = l.url.toLowerCase();
          return linkDomain.includes(domain) ||
            (domain.includes("rozetka") && linkDomain.includes("rozetka")) ||
            (domain.includes("епіцентр") && linkDomain.includes("epicentr")) ||
            (domain.includes("epicentr") && linkDomain.includes("epicentr")) ||
            (domain.includes("prom") && linkDomain.includes("prom.ua")) ||
            (domain.includes("130") && linkDomain.includes("130.com")) ||
            (domain.includes("foxtrot") && linkDomain.includes("foxtrot")) ||
            (domain.includes("allo") && linkDomain.includes("allo.ua")) ||
            (domain.includes("comfy") && linkDomain.includes("comfy")) ||
            (domain.includes("moyo") && linkDomain.includes("moyo"));
        });

        return {
          store: storeName,
          price: parseFloat(String(c.price).replace(/\s/g, "").replace(",", ".")) || 0,
          url: matchingLink?.url || "",
          note: c.note || undefined,
        };
      }).filter((c: any) => c.price > 0);
    } catch {
      summary = "Не вдалось розпарсити відповідь AI";
    }

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
      searchLinks: searchLinks.slice(0, 10),
      cheapestPrice,
      priceDiff: cheapestPrice !== null ? ourPrice - cheapestPrice : null,
      summary,
    };
  } catch (e: any) {
    return {
      productId: product.id,
      productName,
      sku,
      ourPrice,
      ourCostPrice,
      competitors: [],
      searchLinks: [],
      cheapestPrice: null,
      priceDiff: null,
      summary: `Помилка: ${e.message}`,
    };
  }
}
