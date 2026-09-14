/**
 * Рушій цін вітрини — ЄДИНИЙ, хто пише Product.price.
 *
 * Ціновий шар (docs/pricing.md) складається з окремих таблиць:
 *
 *   Price1C      — що назвала 1С («6.МАГАЗИНИ», «4.ОПТ»), як є;
 *   MarketPrice  — скільки той самий товар коштує на сайтах виробників;
 *   PricePolicy  — націнка й підлога, загальні та по брендах;
 *   SitePrice    — результат: ціна вітрини, з чого вона вийшла і що з нею не так.
 *
 * Product.price — копія SitePrice.price для читачів каталогу, кошика, застосунку
 * й SEO. Копія, а не заміна, свідомо: ціну читають десятки запитів (фільтри,
 * сортування, фасети, ISR-сторінки), і перевести їх усі на JOIN означало б
 * переписати каталог заради того самого числа.
 *
 * Хто кличе рушій: обмін з 1С (змінились ціни 1С), воркер (змінились ринкові),
 * адмінка (змінилось правило) і scripts/pricing/reprice.mts. Рушій ідемпотентний:
 * повторний прогін без зміни вхідних даних нічого не пише.
 */
import { Prisma, type SitePriceBasis } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeSitePrice, type SitePriceFlag } from "./compute";
import { loadPolicies, policyFor } from "./policy";

/** Ринкова ціна, старша за це, — вже не ринок. Воркер переперевіряє раз на тиждень. */
export const MARKET_FRESH_DAYS = 21;

const CHUNK = 1000;
const EPS = 0.005;

export type RepriceScope = { productIds: string[] } | { brandId: string } | { all: true };

export type RepriceChange = {
  productId: string;
  sku: string | null;
  name: string;
  brandId: string | null;
  oldPrice: number;
  newPrice: number;
  basis: SitePriceBasis;
  wholesale: number | null;
  market: number | null;
};

export type RepriceResult = {
  /** Товарів з цінами 1С у межах вибірки. */
  evaluated: number;
  siteRowsWritten: number;
  /** Скільки цін на вітрині змінилось (або змінилося б — у пробі). */
  priceChanged: number;
  byBasis: Partial<Record<SitePriceBasis, number>>;
  byFlag: Partial<Record<SitePriceFlag, number>>;
  changes: RepriceChange[];
};

type Row = {
  id: string;
  sku: string | null;
  name: string;
  brandId: string | null;
  price: number;
  priceDerived: boolean;
  wholesale: number | null;
  retail1C: number | null;
  market: number | null;
  marketSource: string | null;
  spPrice: number | null;
  spBasis: SitePriceBasis | null;
  spFlags: string[] | null;
  spWholesale: number | null;
  spRetail1C: number | null;
  spMarket: number | null;
  spMarketSource: string | null;
  spMarkup: number | null;
  spMinMarkup: number | null;
};

const near = (a: number | null, b: number | null) =>
  a === null || b === null ? a === b : Math.abs(a - b) <= EPS;

function sameFlags(a: string[] | null, b: string[]): boolean {
  const x = [...(a ?? [])].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function scopeSql(scope: RepriceScope): Prisma.Sql {
  if ("productIds" in scope) return Prisma.sql`p.id = ANY(${scope.productIds}::text[])`;
  if ("brandId" in scope) return Prisma.sql`p."brandId" = ${scope.brandId}`;
  return Prisma.sql`TRUE`;
}

export async function repriceProducts(
  scope: RepriceScope,
  opts: { preview?: boolean } = {}
): Promise<RepriceResult> {
  const result: RepriceResult = {
    evaluated: 0,
    siteRowsWritten: 0,
    priceChanged: 0,
    byBasis: {},
    byFlag: {},
    changes: [],
  };
  if ("productIds" in scope && scope.productIds.length === 0) return result;

  const policies = await loadPolicies();
  const freshFrom = new Date(Date.now() - MARKET_FRESH_DAYS * 86_400_000);

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT p.id, p.sku, p.name, p."brandId", p.price, p."priceDerived",
           w.price AS "wholesale", r.price AS "retail1C",
           m.price AS "market", m.source AS "marketSource",
           s.price AS "spPrice", s.basis::text AS "spBasis", s.flags AS "spFlags",
           s.wholesale AS "spWholesale", s."retail1C" AS "spRetail1C",
           s.market AS "spMarket", s."marketSource" AS "spMarketSource",
           s.markup AS "spMarkup", s."minMarkup" AS "spMinMarkup"
    FROM "Product" p
    LEFT JOIN "Price1C" w ON w."productId" = p.id AND w.kind = 'WHOLESALE'
    LEFT JOIN "Price1C" r ON r."productId" = p.id AND r.kind = 'RETAIL'
    LEFT JOIN LATERAL (
      SELECT mp.price, mp.source
      FROM "MarketPrice" mp
      WHERE mp."productId" = p.id AND mp."seenAt" >= ${freshFrom}
      ORDER BY mp.price ASC
      LIMIT 1
    ) m ON TRUE
    LEFT JOIN "SitePrice" s ON s."productId" = p.id
    WHERE ${scopeSql(scope)} AND (w.price IS NOT NULL OR r.price IS NOT NULL)
  `;

  const siteRows: Record<string, unknown>[] = [];
  const productRows: { id: string; price: number; derived: boolean }[] = [];

  for (const row of rows) {
    result.evaluated++;
    const res = computeSitePrice({
      wholesale: row.wholesale,
      retail1C: row.retail1C,
      market: row.market !== null && row.marketSource ? { price: row.market, source: row.marketSource } : null,
      policy: policyFor(policies, row.brandId),
    });
    result.byBasis[res.basis] = (result.byBasis[res.basis] ?? 0) + 1;
    for (const f of res.flags) result.byFlag[f] = (result.byFlag[f] ?? 0) + 1;
    if (res.price === null) continue;

    const unchanged =
      row.spPrice !== null &&
      near(row.spPrice, res.price) &&
      row.spBasis === res.basis &&
      sameFlags(row.spFlags, res.flags) &&
      near(row.spWholesale, row.wholesale) &&
      near(row.spRetail1C, row.retail1C) &&
      near(row.spMarket, res.market) &&
      row.spMarketSource === res.marketSource &&
      near(row.spMarkup, res.markup) &&
      near(row.spMinMarkup, res.minMarkup);

    if (!unchanged) {
      siteRows.push({
        productId: row.id,
        price: res.price,
        basis: res.basis,
        wholesale: row.wholesale,
        retail1C: row.retail1C,
        market: res.market,
        marketSource: res.marketSource,
        markup: res.markup,
        minMarkup: res.minMarkup,
        flags: res.flags,
      });
    }

    // «Розрахована» — усе, крім ціни 1С як є. Поле читають лише старі звіти.
    const derived = res.basis !== "RETAIL_1C";
    const priceMoved = Math.abs(row.price - res.price) > EPS;
    if (priceMoved || row.priceDerived !== derived) {
      productRows.push({ id: row.id, price: res.price, derived });
    }
    if (priceMoved) {
      result.priceChanged++;
      result.changes.push({
        productId: row.id,
        sku: row.sku,
        name: row.name,
        brandId: row.brandId,
        oldPrice: row.price,
        newPrice: res.price,
        basis: res.basis,
        wholesale: row.wholesale,
        market: res.market,
      });
    }
  }

  if (opts.preview) return result;

  // Спершу SitePrice (джерело правди), потім копія в Product. Між чанками
  // атомарності немає, і вона не потрібна: повторний прогін доробить решту.
  for (let i = 0; i < siteRows.length; i += CHUNK) {
    const chunk = JSON.stringify(siteRows.slice(i, i + CHUNK));
    result.siteRowsWritten += await prisma.$executeRaw`
      INSERT INTO "SitePrice" ("productId", price, basis, wholesale, "retail1C", market, "marketSource", markup, "minMarkup", flags, "changedAt")
      SELECT x."productId", x.price, x.basis::"SitePriceBasis", x.wholesale, x."retail1C", x.market, x."marketSource",
             x.markup, x."minMarkup", COALESCE(x.flags, '{}'), now()
      FROM jsonb_to_recordset(${chunk}::jsonb) AS x(
        "productId" text, price float8, basis text, wholesale float8, "retail1C" float8, market float8,
        "marketSource" text, markup float8, "minMarkup" float8, flags text[]
      )
      ON CONFLICT ("productId") DO UPDATE SET
        price = EXCLUDED.price, basis = EXCLUDED.basis, wholesale = EXCLUDED.wholesale,
        "retail1C" = EXCLUDED."retail1C", market = EXCLUDED.market, "marketSource" = EXCLUDED."marketSource",
        markup = EXCLUDED.markup, "minMarkup" = EXCLUDED."minMarkup", flags = EXCLUDED.flags, "changedAt" = now()
    `;
  }

  for (let i = 0; i < productRows.length; i += CHUNK) {
    const chunk = JSON.stringify(productRows.slice(i, i + CHUNK));
    await prisma.$executeRaw`
      UPDATE "Product" p
      SET price = x.price, "priceDerived" = x.derived, "updatedAt" = now()
      FROM jsonb_to_recordset(${chunk}::jsonb) AS x(id text, price float8, derived boolean)
      WHERE p.id = x.id
    `;
  }

  return result;
}

export const BASIS_LABELS: Record<SitePriceBasis, string> = {
  MARKUP: "опт + націнка",
  MARKET: "до ціни ринку",
  FLOOR: "на підлозі, ринок дешевший",
  RETAIL_1C: "ціна 1С",
  NONE: "без цін 1С",
};
