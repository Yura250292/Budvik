import { prisma } from "./prisma";

// Розрахунок винесено в окремий модуль без Prisma, щоб ним міг користуватись
// і клієнтський код; ре-експорт зберігає старі імпорти серверних роутів.
export { extractBrand, getWholesalePrice } from "./wholesale-price-calc";

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
