/**
 * Знижки: скільки маржі віддано і кому.
 *
 * Питання, з якого модуль виріс: рентабельність падає з березня (17,2% →
 * 13,8%), і вона обернено пропорційна обороту — найбільший продавець має
 * найнижчу маржу. Гіпотеза: великі клієнти вибивають знижки, які з'їдають
 * вал. Тут вона перевіряється числами.
 *
 * ДВА ВИДИ ЗНИЖОК, і рахувати треба обидва:
 *
 *   1. ЯВНА — різниця між сумою позицій і сумою документа. Менеджер
 *      натиснув «знижка 5%», і 1С зменшила підсумок шапки, не чіпаючи
 *      ціни рядків. Виміряно за 2026: 542 документи, 428 906 грн.
 *
 *   2. ПРИХОВАНА — рядок проданий дешевше, ніж цей самий товар звичайно
 *      їде. Знижки в шапці немає, ціна просто набрана нижча. Виміряно:
 *      4870 рядків, 931 479 грн — ВДВІЧІ більше за явну.
 *
 * Друга і є справжня проблема: вона не видна ні в документі, ні в звіті
 * 1С, бо формально це просто «така ціна».
 *
 * ЧОМУ МЕДІАНА, А НЕ ПРАЙС. `Product.price` — це роздріб магазину, а
 * торгові возять опт: порівняння з ним показало б «знижку» на кожному
 * рядку. Медіана фактичних цін продажу — це «скільки цей товар зазвичай
 * їде», тобто та сама ціна, від якої менеджер відступив. Медіана, а не
 * середнє: одна відпускна ціна вдвічі нижча зсуває середнє так, що решта
 * рядків стає «дорожчою за норму».
 */

import { prisma } from "@/lib/prisma";
import { clampFrom } from "@/lib/analytics/facts";

/**
 * Мінімум продажів товару, щоб рахувати його медіанну ціну.
 *
 * На двох-трьох рядках медіана — це просто одна з цін, і будь-який
 * відступ від неї нічого не означає. П'ять — межа, з якої «звичайна ціна»
 * починає бути звичайною.
 */
const MIN_SALES_FOR_MEDIAN = 5;

/**
 * Наскільки нижче медіани рядок вважається знижкою.
 *
 * 2% — це шум округлення й копійчаних різниць у прайсі, не рішення
 * менеджера. Нижче цього порога рядки не рахуються зовсім.
 */
const DISCOUNT_THRESHOLD = 0.02;

export type DiscountTotals = {
  revenue: number;
  /** Явна знижка: сума позицій мінус сума документа. */
  explicit: number;
  explicitDocs: number;
  /** Прихована: продано нижче медіанної ціни товару. */
  hidden: number;
  hiddenLines: number;
  /** Разом у % від обороту — скільки віддали. */
  totalPct: number;
  /** Вал за той самий період, для порівняння масштабу. */
  gross: number;
};

export type RepDiscount = {
  repId: string;
  repName: string;
  revenue: number;
  explicit: number;
  hidden: number;
  total: number;
  /** % від власного обороту — так торгові порівнюються між собою. */
  pctOfRevenue: number;
  gross: number;
  /** Рентабельність, щоб бачити зв'язок зі знижками. */
  grossPct: number;
};

export type ClientDiscount = {
  counterpartyId: string;
  name: string;
  repName: string | null;
  revenue: number;
  explicit: number;
  hidden: number;
  total: number;
  pctOfRevenue: number;
  gross: number;
  grossPct: number;
  docs: number;
};

export type ProductDiscount = {
  productId: string;
  name: string;
  brandName: string | null;
  medianPrice: number;
  /** Середня фактична ціна серед знижених рядків. */
  avgSoldPrice: number;
  lines: number;
  qty: number;
  lost: number;
};

export type DiscountReport = {
  totals: DiscountTotals;
  byRep: RepDiscount[];
  byClient: ClientDiscount[];
  byProduct: ProductDiscount[];
  minSalesForMedian: number;
};

/**
 * Спільна основа: документ + його списковий підсумок, собівартість і
 * прихована знижка. Виноситься в CTE один раз, бо потрібна в чотирьох
 * розрізах — по компанії, торгових, клієнтах і товарах.
 */
export async function buildDiscountReport(from: Date, to: Date): Promise<DiscountReport> {
  from = clampFrom(from);

  const [totalsRows, repRows, clientRows, productRows] = await Promise.all([
    prisma.$queryRaw<Array<DiscountTotals>>`
      WITH med AS (
        SELECT i."productId",
               percentile_cont(0.5) WITHIN GROUP (ORDER BY i."sellingPrice") AS price
        FROM "SalesDocumentItem" i
        JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
        WHERE s."docType" = 'REALIZATION' AND s.status = 'CONFIRMED'
          AND s."externalId" IS NOT NULL AND i."sellingPrice" > 0
          -- Валютні документи не беруть участі у формуванні медіани й не
          -- рахуються як знижка: там ціна лежить у валюті договору, а
          -- медіана — у гривні, тож «знижка» виходила б у розмір курсу
          -- (у одного клієнта це дало 3159% обороту). Ознака та сама, що
          -- в apply-documents: собівартість кратно вища за ціну.
          AND NOT EXISTS (
            SELECT 1 FROM "SalesDocumentItem" x
            WHERE x."salesDocumentId" = s.id
              AND x."purchasePrice" > x."sellingPrice" * 5
          )
        GROUP BY 1
        HAVING COUNT(*) >= ${MIN_SALES_FOR_MEDIAN}
      ),
      docs AS (
        SELECT s.id, s."totalAmount",
               SUM(i.quantity * i."sellingPrice") AS list_sum,
               SUM(i.quantity * i."purchasePrice") FILTER (WHERE i."purchasePrice" > 0) AS cost,
               COALESCE(SUM(
                 GREATEST(0, m.price - i."sellingPrice") * i.quantity
               ) FILTER (WHERE i."sellingPrice" < m.price * ${1 - DISCOUNT_THRESHOLD}), 0) AS hidden,
               COUNT(*) FILTER (WHERE i."sellingPrice" < m.price * ${1 - DISCOUNT_THRESHOLD}) AS hidden_lines
        FROM "SalesDocument" s
        JOIN "SalesDocumentItem" i ON i."salesDocumentId" = s.id
        LEFT JOIN med m ON m."productId" = i."productId"
        WHERE s."docType" = 'REALIZATION' AND s.status = 'CONFIRMED'
          AND s."externalId" IS NOT NULL
          AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
          -- Валютні документи виключені: див. коментар у med вище.
          AND NOT EXISTS (
            SELECT 1 FROM "SalesDocumentItem" x
            WHERE x."salesDocumentId" = s.id
              AND x."purchasePrice" > x."sellingPrice" * 5
          )
          -- Другий запобіжник, для документів, у яких собівартість уже
          -- занулена (тоді перша ознака не спрацьовує): «знижка» не може
          -- перевищувати сам оборот документа. У валютних вона виходила
          -- в 30 разів більшою, бо медіана гривнева, а ціни доларові.
          AND s."totalAmount" > 0
          AND (
            SELECT SUM(GREATEST(0, mm.price - y."sellingPrice") * y.quantity)
            FROM "SalesDocumentItem" y
            JOIN med mm ON mm."productId" = y."productId"
            WHERE y."salesDocumentId" = s.id
          ) < s."totalAmount"
        GROUP BY s.id, s."totalAmount"
      )
      SELECT
        COALESCE(SUM("totalAmount"), 0)::float AS revenue,
        COALESCE(SUM(GREATEST(0, list_sum - "totalAmount")), 0)::float AS explicit,
        COUNT(*) FILTER (WHERE list_sum - "totalAmount" > 1)::int AS "explicitDocs",
        COALESCE(SUM(hidden), 0)::float AS hidden,
        COALESCE(SUM(hidden_lines), 0)::int AS "hiddenLines",
        0::float AS "totalPct",
        COALESCE(SUM("totalAmount" - cost) FILTER (WHERE cost IS NOT NULL), 0)::float AS gross
      FROM docs
    `,
    prisma.$queryRaw<Array<Omit<RepDiscount, "total" | "pctOfRevenue" | "grossPct">>>`
      WITH med AS (
        SELECT i."productId",
               percentile_cont(0.5) WITHIN GROUP (ORDER BY i."sellingPrice") AS price
        FROM "SalesDocumentItem" i
        JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
        WHERE s."docType" = 'REALIZATION' AND s.status = 'CONFIRMED'
          AND s."externalId" IS NOT NULL AND i."sellingPrice" > 0
          -- Валютні документи не беруть участі у формуванні медіани й не
          -- рахуються як знижка: там ціна лежить у валюті договору, а
          -- медіана — у гривні, тож «знижка» виходила б у розмір курсу
          -- (у одного клієнта це дало 3159% обороту). Ознака та сама, що
          -- в apply-documents: собівартість кратно вища за ціну.
          AND NOT EXISTS (
            SELECT 1 FROM "SalesDocumentItem" x
            WHERE x."salesDocumentId" = s.id
              AND x."purchasePrice" > x."sellingPrice" * 5
          )
        GROUP BY 1 HAVING COUNT(*) >= ${MIN_SALES_FOR_MEDIAN}
      ),
      docs AS (
        SELECT s.id, s."salesRepId", s."totalAmount",
               SUM(i.quantity * i."sellingPrice") AS list_sum,
               SUM(i.quantity * i."purchasePrice") FILTER (WHERE i."purchasePrice" > 0) AS cost,
               COALESCE(SUM(GREATEST(0, m.price - i."sellingPrice") * i.quantity)
                 FILTER (WHERE i."sellingPrice" < m.price * ${1 - DISCOUNT_THRESHOLD}), 0) AS hidden
        FROM "SalesDocument" s
        JOIN "SalesDocumentItem" i ON i."salesDocumentId" = s.id
        LEFT JOIN med m ON m."productId" = i."productId"
        WHERE s."docType" = 'REALIZATION' AND s.status = 'CONFIRMED'
          AND s."externalId" IS NOT NULL AND s."salesRepId" IS NOT NULL
          AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
          -- Валютні документи виключені: див. коментар у med вище.
          AND NOT EXISTS (
            SELECT 1 FROM "SalesDocumentItem" x
            WHERE x."salesDocumentId" = s.id
              AND x."purchasePrice" > x."sellingPrice" * 5
          )
          -- Другий запобіжник, для документів, у яких собівартість уже
          -- занулена (тоді перша ознака не спрацьовує): «знижка» не може
          -- перевищувати сам оборот документа. У валютних вона виходила
          -- в 30 разів більшою, бо медіана гривнева, а ціни доларові.
          AND s."totalAmount" > 0
          AND (
            SELECT SUM(GREATEST(0, mm.price - y."sellingPrice") * y.quantity)
            FROM "SalesDocumentItem" y
            JOIN med mm ON mm."productId" = y."productId"
            WHERE y."salesDocumentId" = s.id
          ) < s."totalAmount"
        GROUP BY s.id, s."salesRepId", s."totalAmount"
      )
      SELECT
        d."salesRepId" AS "repId",
        u.name AS "repName",
        SUM(d."totalAmount")::float AS revenue,
        SUM(GREATEST(0, d.list_sum - d."totalAmount"))::float AS explicit,
        SUM(d.hidden)::float AS hidden,
        COALESCE(SUM(d."totalAmount" - d.cost) FILTER (WHERE d.cost IS NOT NULL), 0)::float AS gross
      FROM docs d
      JOIN "User" u ON u.id = d."salesRepId"
      GROUP BY d."salesRepId", u.name
    `,
    prisma.$queryRaw<Array<Omit<ClientDiscount, "total" | "pctOfRevenue" | "grossPct">>>`
      WITH med AS (
        SELECT i."productId",
               percentile_cont(0.5) WITHIN GROUP (ORDER BY i."sellingPrice") AS price
        FROM "SalesDocumentItem" i
        JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
        WHERE s."docType" = 'REALIZATION' AND s.status = 'CONFIRMED'
          AND s."externalId" IS NOT NULL AND i."sellingPrice" > 0
          -- Валютні документи не беруть участі у формуванні медіани й не
          -- рахуються як знижка: там ціна лежить у валюті договору, а
          -- медіана — у гривні, тож «знижка» виходила б у розмір курсу
          -- (у одного клієнта це дало 3159% обороту). Ознака та сама, що
          -- в apply-documents: собівартість кратно вища за ціну.
          AND NOT EXISTS (
            SELECT 1 FROM "SalesDocumentItem" x
            WHERE x."salesDocumentId" = s.id
              AND x."purchasePrice" > x."sellingPrice" * 5
          )
        GROUP BY 1 HAVING COUNT(*) >= ${MIN_SALES_FOR_MEDIAN}
      ),
      docs AS (
        SELECT s.id, s."counterpartyId", s."salesRepId", s."totalAmount",
               SUM(i.quantity * i."sellingPrice") AS list_sum,
               SUM(i.quantity * i."purchasePrice") FILTER (WHERE i."purchasePrice" > 0) AS cost,
               COALESCE(SUM(GREATEST(0, m.price - i."sellingPrice") * i.quantity)
                 FILTER (WHERE i."sellingPrice" < m.price * ${1 - DISCOUNT_THRESHOLD}), 0) AS hidden
        FROM "SalesDocument" s
        JOIN "SalesDocumentItem" i ON i."salesDocumentId" = s.id
        LEFT JOIN med m ON m."productId" = i."productId"
        WHERE s."docType" = 'REALIZATION' AND s.status = 'CONFIRMED'
          AND s."externalId" IS NOT NULL AND s."counterpartyId" IS NOT NULL
          AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
          -- Валютні документи виключені: див. коментар у med вище.
          AND NOT EXISTS (
            SELECT 1 FROM "SalesDocumentItem" x
            WHERE x."salesDocumentId" = s.id
              AND x."purchasePrice" > x."sellingPrice" * 5
          )
          -- Другий запобіжник, для документів, у яких собівартість уже
          -- занулена (тоді перша ознака не спрацьовує): «знижка» не може
          -- перевищувати сам оборот документа. У валютних вона виходила
          -- в 30 разів більшою, бо медіана гривнева, а ціни доларові.
          AND s."totalAmount" > 0
          AND (
            SELECT SUM(GREATEST(0, mm.price - y."sellingPrice") * y.quantity)
            FROM "SalesDocumentItem" y
            JOIN med mm ON mm."productId" = y."productId"
            WHERE y."salesDocumentId" = s.id
          ) < s."totalAmount"
        GROUP BY s.id, s."counterpartyId", s."salesRepId", s."totalAmount"
      )
      SELECT
        d."counterpartyId",
        c.name,
        -- Торговий клієнта: той, хто вів найбільше документів у періоді.
        -- MAX(id) взяв би випадкового — а тут потрібен «чий це клієнт».
        (
          SELECT u.name FROM "SalesDocument" sd
          JOIN "User" u ON u.id = sd."salesRepId"
          WHERE sd."counterpartyId" = d."counterpartyId"
            AND sd."salesRepId" IS NOT NULL AND sd."docType" = 'REALIZATION'
            AND sd."createdAt" >= ${from} AND sd."createdAt" <= ${to}
          GROUP BY u.name
          ORDER BY COUNT(*) DESC
          LIMIT 1
        ) AS "repName",
        SUM(d."totalAmount")::float AS revenue,
        SUM(GREATEST(0, d.list_sum - d."totalAmount"))::float AS explicit,
        SUM(d.hidden)::float AS hidden,
        COALESCE(SUM(d."totalAmount" - d.cost) FILTER (WHERE d.cost IS NOT NULL), 0)::float AS gross,
        COUNT(*)::int AS docs
      FROM docs d
      JOIN "Counterparty" c ON c.id = d."counterpartyId"
      GROUP BY d."counterpartyId", c.name
      HAVING SUM(GREATEST(0, d.list_sum - d."totalAmount")) + SUM(d.hidden) > 0
      ORDER BY (SUM(GREATEST(0, d.list_sum - d."totalAmount")) + SUM(d.hidden)) DESC
      LIMIT 40
    `,
    prisma.$queryRaw<ProductDiscount[]>`
      WITH med AS (
        SELECT i."productId",
               percentile_cont(0.5) WITHIN GROUP (ORDER BY i."sellingPrice") AS price
        FROM "SalesDocumentItem" i
        JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
        WHERE s."docType" = 'REALIZATION' AND s.status = 'CONFIRMED'
          AND s."externalId" IS NOT NULL AND i."sellingPrice" > 0
          -- Валютні документи не беруть участі у формуванні медіани й не
          -- рахуються як знижка: там ціна лежить у валюті договору, а
          -- медіана — у гривні, тож «знижка» виходила б у розмір курсу
          -- (у одного клієнта це дало 3159% обороту). Ознака та сама, що
          -- в apply-documents: собівартість кратно вища за ціну.
          AND NOT EXISTS (
            SELECT 1 FROM "SalesDocumentItem" x
            WHERE x."salesDocumentId" = s.id
              AND x."purchasePrice" > x."sellingPrice" * 5
          )
        GROUP BY 1 HAVING COUNT(*) >= ${MIN_SALES_FOR_MEDIAN}
      )
      SELECT
        i."productId",
        p.name,
        b.name AS "brandName",
        m.price::float AS "medianPrice",
        (SUM(i."sellingPrice" * i.quantity) / NULLIF(SUM(i.quantity), 0))::float AS "avgSoldPrice",
        COUNT(*)::int AS lines,
        SUM(i.quantity)::float AS qty,
        SUM((m.price - i."sellingPrice") * i.quantity)::float AS lost
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN med m ON m."productId" = i."productId"
      JOIN "Product" p ON p.id = i."productId"
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      WHERE s."docType" = 'REALIZATION' AND s.status = 'CONFIRMED'
        AND s."externalId" IS NOT NULL
        AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
        AND NOT EXISTS (
          SELECT 1 FROM "SalesDocumentItem" x
          WHERE x."salesDocumentId" = s.id
            AND x."purchasePrice" > x."sellingPrice" * 5
        )
        AND s."totalAmount" > 0
        AND (
          SELECT SUM(GREATEST(0, mm.price - y."sellingPrice") * y.quantity)
          FROM "SalesDocumentItem" y
          JOIN med mm ON mm."productId" = y."productId"
          WHERE y."salesDocumentId" = s.id
        ) < s."totalAmount"
        AND i."sellingPrice" < m.price * ${1 - DISCOUNT_THRESHOLD}
        AND i.quantity > 0
      GROUP BY i."productId", p.name, b.name, m.price
      ORDER BY 8 DESC
      LIMIT 40
    `,
  ]);

  const t = totalsRows[0] ?? {
    revenue: 0, explicit: 0, explicitDocs: 0, hidden: 0, hiddenLines: 0, totalPct: 0, gross: 0,
  };
  const totals: DiscountTotals = {
    ...t,
    totalPct: t.revenue > 0 ? ((t.explicit + t.hidden) / t.revenue) * 100 : 0,
  };

  const byRep: RepDiscount[] = repRows
    .map((r) => {
      const total = r.explicit + r.hidden;
      return {
        ...r,
        total,
        pctOfRevenue: r.revenue > 0 ? (total / r.revenue) * 100 : 0,
        grossPct: r.revenue > 0 ? (r.gross / r.revenue) * 100 : 0,
      };
    })
    .sort((a, b) => b.total - a.total);

  const byClient: ClientDiscount[] = clientRows.map((r) => {
    const total = r.explicit + r.hidden;
    return {
      ...r,
      total,
      pctOfRevenue: r.revenue > 0 ? (total / r.revenue) * 100 : 0,
      grossPct: r.revenue > 0 ? (r.gross / r.revenue) * 100 : 0,
    };
  });

  return { totals, byRep, byClient, byProduct: productRows, minSalesForMedian: MIN_SALES_FOR_MEDIAN };
}
