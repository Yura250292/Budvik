import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const maxDuration = 120;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Auto-search product images using Gemini with Google Search grounding.
 * Finds real product image URLs from Ukrainian online stores.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { productIds, limit = 5 } = body;

  // Get products to search images for
  let products: any[];

  if (productIds && productIds.length > 0) {
    products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, sku: true, image: true, category: { select: { name: true } } },
    });
  } else {
    // Auto-select products without images that have stock
    products = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [{ image: null }, { image: "" }],
        stock: { gt: 0 },
      },
      select: { id: true, name: true, sku: true, image: true, category: { select: { name: true } } },
      orderBy: { stock: "desc" },
      take: Math.min(limit, 20),
    });
  }

  if (products.length === 0) {
    return NextResponse.json({ results: [], message: "No products to process" });
  }

  const results: {
    productId: string;
    productName: string;
    imageUrl: string | null;
    source: string;
    status: "found" | "not_found" | "error";
  }[] = [];

  // Process in batches of 2 (to avoid rate limits)
  for (let i = 0; i < products.length; i += 2) {
    const batch = products.slice(i, i + 2);
    const batchResults = await Promise.all(
      batch.map((p) => searchProductImage(p))
    );
    results.push(...batchResults);

    // Small delay between batches
    if (i + 2 < products.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Auto-apply found images
  const found = results.filter((r) => r.status === "found" && r.imageUrl);
  if (found.length > 0 && !body.dryRun) {
    await prisma.$transaction(
      found.map((r) =>
        prisma.product.update({
          where: { id: r.productId },
          data: { image: r.imageUrl! },
        })
      )
    );
  }

  return NextResponse.json({
    results,
    applied: body.dryRun ? 0 : found.length,
    total: products.length,
  });
}

async function searchProductImage(product: any): Promise<{
  productId: string;
  productName: string;
  imageUrl: string | null;
  source: string;
  status: "found" | "not_found" | "error";
}> {
  const name = product.name;
  const sku = product.sku && !product.sku.startsWith("1C-") ? product.sku : "";
  const category = product.category?.name || "";

  const searchQuery = sku ? `${name} ${sku}` : name;

  const prompt = `Знайди фото товару "${searchQuery}" (категорія: ${category || "інструменти"}).

Мені потрібне ПРЯМЕ посилання на зображення товару (URL що закінчується на .jpg, .jpeg, .png, .webp).

Шукай в українських інтернет-магазинах: Rozetka, Епіцентр, Prom.ua, 130.com.ua, та інших.

ВАЖЛИВО: Відповідь ТІЛЬКИ у форматі JSON, без markdown:
{
  "imageUrl": "https://...image.jpg",
  "source": "назва магазину де знайшов",
  "confidence": "high" | "medium" | "low"
}

Якщо не знайшов точне фото цього товару — поверни:
{ "imageUrl": null, "source": "", "confidence": "none" }

НЕ вигадуй URL. Тільки реальні посилання з результатів пошуку.`;

  try {
    const url = `${GEMINI_BASE_URL}/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const reqBody = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [
          {
            text: "Ти помічник для пошуку фото товарів. Шукай ТІЛЬКИ реальні зображення конкретного товару в українських магазинах. Не вигадуй URL.",
          },
        ],
      },
      tools: [{ googleSearch: {} }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
      },
    };

    let res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
    });

    if (res.status === 429) {
      const retryAfter = Math.min(parseInt(res.headers.get("retry-after") || "30", 10), 45);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
    }

    if (!res.ok) {
      throw new Error(`Gemini ${res.status}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || "";

    // Also extract image URLs from grounding metadata
    const groundingMeta = candidate?.groundingMetadata;
    const groundingChunks = groundingMeta?.groundingChunks || [];

    // Try to parse AI response
    let jsonStr = text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    try {
      const parsed = JSON.parse(jsonStr);

      // Validate the image URL is real
      if (parsed.imageUrl && parsed.confidence !== "none") {
        // Try to verify the image exists (HEAD request)
        const verified = await verifyImageUrl(parsed.imageUrl);
        if (verified) {
          return {
            productId: product.id,
            productName: name,
            imageUrl: parsed.imageUrl,
            source: parsed.source || "AI Search",
            status: "found",
          };
        }
      }

      // Fallback: try to extract image from grounding chunks
      for (const chunk of groundingChunks) {
        if (chunk.web?.uri) {
          const imgUrl = await tryExtractImageFromPage(chunk.web.uri, name);
          if (imgUrl) {
            return {
              productId: product.id,
              productName: name,
              imageUrl: imgUrl,
              source: chunk.web.title || "Grounding",
              status: "found",
            };
          }
        }
      }
    } catch {
      // JSON parse failed
    }

    return {
      productId: product.id,
      productName: name,
      imageUrl: null,
      source: "",
      status: "not_found",
    };
  } catch (e: any) {
    return {
      productId: product.id,
      productName: name,
      imageUrl: null,
      source: e.message,
      status: "error",
    };
  }
}

async function verifyImageUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });
    const ct = res.headers.get("content-type") || "";
    return res.ok && ct.startsWith("image/");
  } catch {
    return false;
  }
}

async function tryExtractImageFromPage(pageUrl: string, productName: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; BudvikBot/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Look for og:image meta tag
    const ogMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i);

    if (ogMatch?.[1]) {
      const imgUrl = ogMatch[1];
      if (imgUrl.match(/\.(jpg|jpeg|png|webp)/i)) {
        return imgUrl;
      }
    }

    return null;
  } catch {
    return null;
  }
}
