/**
 * Товари: пошук під питання торгового і мертвий залишок на складі.
 *
 * Обидві відповіді спираються на ВІЛЬНИЙ залишок (LocationStock без
 * сервісних складів), а не на Product.stock. Останній застигає, коли
 * позиція зникає з регістра 1С: заміряно 922 активні товари з ціною, що
 * показували до 844 шт залишку, не маючи жодного рядка на складі.
 * Пообіцяти клієнту такий товар — гірше, ніж не пропонувати нічого.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FREE_STOCK_ALL, LAST_COST, LAST_SALE, myClientsCte } from "@/lib/assistant/facts/sql";
import { SECTION_BY_ID, SECTIONS } from "@/lib/catalog/classify";

export type ProductHit = {
  productId: string;
  name: string;
  sku: string | null;
  brand: string | null;
  typeKey: string | null;
  sectionId: string | null;
  price: number;
  wholesalePrice: number | null;
  free: number;
  lastCost: number | null;
  lastSale: Date | null;
  myBuyers: number;
};

/**
 * Пошук товару за назвою, артикулом або штрихкодом.
 *
 * Порядок збігів: спершу точний артикул, далі — товари з ціною, далі — за
 * вільним залишком. Торговий питає про товар тоді, коли збирається його
 * продати, тож позиція без ціни або без залишку у відповіді нижча.
 *
 * Позиції з нульовою ціною не ховаємо: їх у базі сотні (тип цін
 * «6.МАГАЗИНИ» заповнений не для всіх брендів), і мовчазне «нічого не
 * знайдено» на товар, який торговий тримає в руках, гірше за чесне
 * «ціни в 1С немає».
 */
export async function searchProducts(
  query: string,
  repId: string,
  limit = 8
): Promise<ProductHit[]> {
  /**
   * Кожне слово окремо, а не весь рядок підрядком.
   *
   * Торговий питає «круг відрізний 125», а в 1С товар зветься «Круг
   * відрізний (метал) ATAMAN 125 1,2 22,23». Суцільний підрядок не
   * збігається — і пошук чесно відповідає «нічого не знайшли» на позицію,
   * якої на складі 26 тисяч штук.
   */
  const words = query
    .split(/\s+/)
    .map((w) => w.replace(/[%_]/g, "").trim())
    .filter((w) => w.length >= 2)
    .slice(0, 6);
  const patterns = (words.length ? words : [query]).map((w) => `%${w}%`);
  const like = `%${query.replace(/[%_]/g, "")}%`;

  return prisma.$queryRaw<ProductHit[]>`
    WITH ${LAST_COST}, ${LAST_SALE}, ${FREE_STOCK_ALL}, ${myClientsCte(repId)},
    my_buyers AS (
      SELECT i."productId", COUNT(DISTINCT s."counterpartyId")::int AS n
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."docType" = 'REALIZATION'
        AND s."counterpartyId" IN (SELECT id FROM my_clients)
      GROUP BY 1
    )
    SELECT
      p.id AS "productId", p.name, p.sku, b.name AS brand,
      p."typeKey", p."sectionId",
      p.price::float AS price,
      p."wholesalePrice"::float AS "wholesalePrice",
      COALESCE(fs.free, 0) AS free,
      lc.cost AS "lastCost",
      ls.ts AS "lastSale",
      COALESCE(mb.n, 0) AS "myBuyers"
    FROM "Product" p
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    LEFT JOIN free_stock fs ON fs."productId" = p.id
    LEFT JOIN last_cost lc ON lc."productId" = p.id
    LEFT JOIN last_sale ls ON ls."productId" = p.id
    LEFT JOIN my_buyers mb ON mb."productId" = p.id
    WHERE p."isActive"
      AND (
        p.name ILIKE ALL(${patterns}::text[])
        OR p.sku ILIKE ${like}
        OR ${query} = ANY(p.barcodes)
      )
    ORDER BY (p.sku = ${query}) DESC, (p.price > 0) DESC, COALESCE(fs.free, 0) DESC, p.priority DESC
    LIMIT ${limit}
  `;
}

export type DeadStockFilters = {
  repId: string;
  brand?: string | null;
  section?: string | null;
  typeKey?: string | null;
  /** Лише те, що вже брав хтось із клієнтів цього торгового. */
  boughtByMyClients?: boolean;
  minDays: number;
  limit: number;
};

/**
 * Мертвий залишок: лежить на складі, а продажів немає.
 *
 * Сортування за грошима (залишок × собівартість), а не за днями: сто
 * позицій по одній штуці — це не проблема складу, а одна позиція на
 * 40 тисяч — проблема. Торговому потрібне саме те, що варто зусиль.
 */
export async function deadStockItems(f: DeadStockFilters): Promise<ProductHit[]> {
  const brandCond = f.brand
    ? Prisma.sql`AND b.name ILIKE ${`%${f.brand.replace(/[%_]/g, "")}%`}`
    : Prisma.empty;

  const sectionId = f.section ? resolveSection(f.section) : null;
  const sectionCond = sectionId ? Prisma.sql`AND p."sectionId" = ${sectionId}` : Prisma.empty;
  const typeCond = f.typeKey ? Prisma.sql`AND p."typeKey" = ${f.typeKey}` : Prisma.empty;
  const mineCond = f.boughtByMyClients ? Prisma.sql`AND COALESCE(mb.n, 0) > 0` : Prisma.empty;

  return prisma.$queryRaw<ProductHit[]>`
    WITH ${LAST_COST}, ${LAST_SALE}, ${FREE_STOCK_ALL}, ${myClientsCte(f.repId)},
    my_buyers AS (
      SELECT i."productId", COUNT(DISTINCT s."counterpartyId")::int AS n
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."docType" = 'REALIZATION'
        AND s."counterpartyId" IN (SELECT id FROM my_clients)
      GROUP BY 1
    )
    SELECT
      p.id AS "productId", p.name, p.sku, b.name AS brand,
      p."typeKey", p."sectionId",
      p.price::float AS price,
      p."wholesalePrice"::float AS "wholesalePrice",
      fs.free AS free,
      lc.cost AS "lastCost",
      ls.ts AS "lastSale",
      COALESCE(mb.n, 0) AS "myBuyers"
    FROM "Product" p
    JOIN free_stock fs ON fs."productId" = p.id
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    LEFT JOIN last_cost lc ON lc."productId" = p.id
    LEFT JOIN last_sale ls ON ls."productId" = p.id
    LEFT JOIN my_buyers mb ON mb."productId" = p.id
    WHERE p."isActive"
      AND p."externalId" IS NOT NULL
      AND p.price > 0
      AND fs.free > 0
      AND (ls.ts IS NULL OR ls.ts < NOW() - (${f.minDays} * INTERVAL '1 day'))
      ${brandCond} ${sectionCond} ${typeCond} ${mineCond}
    ORDER BY fs.free * COALESCE(lc.cost, p.price) DESC
    LIMIT ${f.limit}
  `;
}

/** Розділ приймаємо і кодом (osnastka), і назвою («Оснастка»). */
function resolveSection(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (SECTION_BY_ID.has(value)) return value;
  const hit = SECTIONS.find((s) => s.title.toLowerCase().includes(value));
  return hit?.id ?? null;
}
