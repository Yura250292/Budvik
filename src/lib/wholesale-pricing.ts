import { prisma } from "./prisma";

let cachedDiscounts: Map<string, number> | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000; // 1 minute

export async function getBrandDiscounts(): Promise<Map<string, number>> {
  const now = Date.now();
  if (cachedDiscounts && now - cacheTime < CACHE_TTL) {
    return cachedDiscounts;
  }
  const discounts = await prisma.wholesaleBrandDiscount.findMany();
  cachedDiscounts = new Map(discounts.map((d) => [d.brand.toLowerCase(), d.discount]));
  cacheTime = now;
  return cachedDiscounts;
}

export function extractBrand(productName: string): string | null {
  // Brand is typically the last word in uppercase or the first recognizable brand
  // Common pattern in this DB: "Назва товару БРЕНД" or "Назва товару БРЕНД (артикул)"
  const cleaned = productName.replace(/\([^)]*\)/g, "").trim();
  const words = cleaned.split(/\s+/);
  // Check last word first (most common pattern: "...СИЛА", "...APRO", "...SIGMA")
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i];
    if (word.length >= 2 && word === word.toUpperCase() && /^[A-ZА-ЯІЇЄҐ]/.test(word)) {
      return word;
    }
  }
  // Try first word (e.g., "Einhell ...", "Bosch ...")
  if (words.length > 0) {
    const first = words[0];
    if (/^[A-Z][a-z]/.test(first) && first.length >= 3) {
      return first;
    }
  }
  return null;
}

export function getWholesalePrice(
  price: number,
  productName: string,
  brandDiscounts: Map<string, number>,
  explicitWholesalePrice?: number | null
): number {
  // Explicit wholesale price takes priority
  if (explicitWholesalePrice != null) {
    return explicitWholesalePrice;
  }
  // Try brand discount
  const brand = extractBrand(productName);
  if (brand) {
    const discount = brandDiscounts.get(brand.toLowerCase());
    if (discount != null && discount > 0) {
      return Math.round(price * (1 - discount / 100) * 100) / 100;
    }
  }
  return price;
}
