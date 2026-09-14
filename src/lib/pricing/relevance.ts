/**
 * Актуальність товару — що агентові цін робити першим.
 *
 * Сигнали з бази, у порядку ваги:
 *
 *   1. коли товар востаннє продавали (проведені реалізації з 1С): за 30 днів,
 *      за 31–90, за рік, або не продавали рік;
 *   2. скільки разів продавали за 90 днів — кількість реалізацій, а не сума:
 *      сума бреше на валютних документах (див. analytics/discounts.ts);
 *   3. перегляди картки на сайті за 30 днів.
 *
 * 14.09.2026 у наявності: 1464 товари продавались за останні 30 днів, 929 —
 * за 31–90, 901 — давніше, 3523 — жодного разу за рік. Перегляди на сайті
 * рідкі (456 за місяць), тому вони лише впорядковують у межах рівня.
 *
 * Тут — SQL, а не таблиця: реалізацій за рік близько сотні тисяч рядків, і
 * агрегат рахується за частки секунди, тож зберігати його окремо означало б
 * лише мати ще одну річ, яка застаріває.
 */
import { Prisma } from "@prisma/client";

export type RelevanceTier = 1 | 2 | 3 | 4;

export const TIER_LABELS: Record<RelevanceTier, string> = {
  1: "продавався за 30 днів",
  2: "продавався за 31–90 днів",
  3: "продавався за рік",
  4: "не продавався рік",
};

/**
 * CTE з ім'ям rel: productId, tier, sales30, sales90, lastSaleAt, views30.
 * Лише товари, що мають хоч один сигнал; решту приєднують LEFT JOIN і
 * рахують рівнем 4 через COALESCE(rel.tier, 4).
 */
export const RELEVANCE_CTE = Prisma.sql`
  rel_sales AS (
    SELECT i."productId",
           MAX(d."createdAt") AS "lastSaleAt",
           COUNT(DISTINCT d.id) FILTER (WHERE d."createdAt" >= now() - interval '30 days') AS sales30,
           COUNT(DISTINCT d.id) FILTER (WHERE d."createdAt" >= now() - interval '90 days') AS sales90
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" d ON d.id = i."salesDocumentId"
    WHERE d."docType" = 'REALIZATION' AND d.status = 'CONFIRMED' AND d."externalId" IS NOT NULL
      AND d."createdAt" >= now() - interval '365 days'
    GROUP BY 1
  ),
  rel_views AS (
    SELECT "productId", COUNT(*) AS views30
    FROM "SiteEvent"
    WHERE type = 'product_view' AND "productId" IS NOT NULL AND "createdAt" >= now() - interval '30 days'
    GROUP BY 1
  ),
  rel AS (
    SELECT COALESCE(s."productId", v."productId") AS "productId",
           CASE WHEN s."lastSaleAt" >= now() - interval '30 days' THEN 1
                WHEN s."lastSaleAt" >= now() - interval '90 days' THEN 2
                WHEN s."lastSaleAt" IS NOT NULL THEN 3
                ELSE 4 END AS tier,
           COALESCE(s.sales30, 0)::int AS sales30,
           COALESCE(s.sales90, 0)::int AS sales90,
           s."lastSaleAt",
           COALESCE(v.views30, 0)::int AS views30
    FROM rel_sales s
    FULL OUTER JOIN rel_views v ON v."productId" = s."productId"
  )`;

/** «Спершу актуальні» — для запиту, де rel приєднано як LEFT JOIN rel. */
export const RELEVANCE_ORDER = Prisma.sql`COALESCE(rel.tier, 4), COALESCE(rel.sales90, 0) DESC, COALESCE(rel.views30, 0) DESC`;

/**
 * Коли шукати знову товар, для якого агент нічого не знайшов. Те, що
 * продається щомісяця, варто перепитати раніше: у магазинах воно з'являється
 * частіше, а мертвий залишок не варто перебирати щомісяця.
 */
export const LOOKUP_AGAIN_DAYS_BY_TIER: Record<RelevanceTier, number> = { 1: 30, 2: 45, 3: 90, 4: 90 };

/**
 * Як часто переперевіряти відому сторінку. Що продається — кожні три дні;
 * решта не довше 12 днів, щоб ринкова ціна не старіла для щотижневих
 * пропозицій (MARKET_FRESH_DAYS = 14).
 */
export const REFRESH_DAYS_BY_TIER: Record<RelevanceTier, number> = { 1: 3, 2: 7, 3: 12, 4: 12 };

/** CASE з межею дати за рівнем — для умови «давніше, ніж для свого рівня». */
export function tierCutoff(daysByTier: Record<RelevanceTier, number>, now = Date.now()): Prisma.Sql {
  const at = (t: RelevanceTier) => new Date(now - daysByTier[t] * 86_400_000);
  return Prisma.sql`(CASE COALESCE(rel.tier, 4) WHEN 1 THEN ${at(1)} WHEN 2 THEN ${at(2)} WHEN 3 THEN ${at(3)} ELSE ${at(4)} END)`;
}
