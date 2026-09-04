/**
 * Хто що бере: зріз по товарах за півроку.
 *
 * Один запит на весь асортимент, а не запит на кожне питання. Причина
 * практична: на ньому стоять і гачки, і причепи, і пошук товару, і
 * неліквід — тобто в межах однієї відповіді помічника він знадобився б
 * тричі. Так він рахується раз і живе в пам'яті процесу.
 *
 * Чому саме 180 днів: менше — і сезонні позиції (ліска, ланцюги) зникають
 * із картини взимку; більше — і «беруть усі» починає означати «брали
 * колись», а гачок мусить спрацьовувати сьогодні.
 */

import { prisma } from "@/lib/prisma";
import { HOOK_WINDOW_DAYS } from "@/lib/assistant/config";
import { FREE_STOCK_ALL, LAST_COST, LAST_SALE } from "@/lib/assistant/facts/sql";

export type ProductStat = {
  productId: string;
  name: string;
  sku: string | null;
  brandId: string | null;
  brandName: string | null;
  typeKey: string | null;
  sectionId: string | null;
  price: number;
  wholesalePrice: number | null;
  free: number;
  lastCost: number | null;
  lastSale: Date | null;
  /** Різних клієнтів за вікно — головна ознака «бере вся база». */
  clients: number;
  docs: number;
  qty: number;
  revenue: number;
  /** Виручка тих рядків, де собівартість відома — знаменник маржі. */
  costedRevenue: number;
  profit: number;
};

type Row = Omit<ProductStat, "lastSale"> & { lastSale: Date | null };

/**
 * Кеш у пам'яті процесу на 15 хвилин.
 *
 * Не Redis і не таблиця: дані оновлюються нічним обміном з 1С, а запит
 * важить секунду. Проміжок у чверть години прибирає повтори всередині
 * однієї розмови, і більшого тут не треба.
 */
let cache: { at: number; rows: ProductStat[] } | null = null;
const TTL_MS = 15 * 60 * 1000;

export async function productStats(days = HOOK_WINDOW_DAYS): Promise<ProductStat[]> {
  if (days === HOOK_WINDOW_DAYS && cache && Date.now() - cache.at < TTL_MS) return cache.rows;

  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await prisma.$queryRaw<Row[]>`
    WITH ${LAST_COST}, ${LAST_SALE}, ${FREE_STOCK_ALL},
    sold AS (
      SELECT
        i."productId",
        COUNT(DISTINCT s."counterpartyId")::int AS clients,
        COUNT(DISTINCT s.id)::int AS docs,
        SUM(i.quantity)::float AS qty,
        SUM(i.quantity * i."sellingPrice")::float AS revenue,
        SUM(i.quantity * i."sellingPrice") FILTER (WHERE i."purchasePrice" > 0)::float AS "costedRevenue",
        SUM(i.quantity * (i."sellingPrice" - i."purchasePrice")) FILTER (WHERE i."purchasePrice" > 0)::float AS profit
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE s."externalId" IS NOT NULL
        AND s.status = 'CONFIRMED'
        AND s."docType" = 'REALIZATION'
        AND s."createdAt" >= ${since}
        AND s."counterpartyId" IS NOT NULL
      GROUP BY 1
    )
    SELECT
      p.id AS "productId",
      p.name,
      p.sku,
      p."brandId",
      b.name AS "brandName",
      p."typeKey",
      p."sectionId",
      p.price::float AS price,
      p."wholesalePrice"::float AS "wholesalePrice",
      COALESCE(fs.free, 0) AS free,
      lc.cost AS "lastCost",
      ls.ts AS "lastSale",
      sold.clients,
      sold.docs,
      sold.qty,
      sold.revenue,
      COALESCE(sold."costedRevenue", 0) AS "costedRevenue",
      COALESCE(sold.profit, 0) AS profit
    FROM sold
    JOIN "Product" p ON p.id = sold."productId"
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    LEFT JOIN free_stock fs ON fs."productId" = p.id
    LEFT JOIN last_cost lc ON lc."productId" = p.id
    LEFT JOIN last_sale ls ON ls."productId" = p.id
    WHERE p."isActive"
  `;

  const out = rows.map((r) => ({ ...r }));
  if (days === HOOK_WINDOW_DAYS) cache = { at: Date.now(), rows: out };
  return out;
}

/** Маржа у відсотках від виручки; null — собівартість невідома. */
export function marginPct(stat: Pick<ProductStat, "costedRevenue" | "profit">): number | null {
  if (!stat.costedRevenue || stat.costedRevenue <= 0) return null;
  return (stat.profit / stat.costedRevenue) * 100;
}

/** Маржа від прайсової ціни й останньої собівартості — для товару без продажів. */
export function priceMarginPct(price: number, lastCost: number | null): number | null {
  if (!lastCost || lastCost <= 0 || price <= 0) return null;
  return ((price - lastCost) / price) * 100;
}

/** Перцентиль (0..1) по масиву чисел. */
export function percentile(values: number[], p: number): number {
  const list = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (list.length === 0) return 0;
  const idx = Math.min(list.length - 1, Math.max(0, Math.round((list.length - 1) * p)));
  return list[idx];
}

/** Скидання кешу — для скриптів, які міряють час «начисто». */
export function resetProductStatsCache() {
  cache = null;
}
