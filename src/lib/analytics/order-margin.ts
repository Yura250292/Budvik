/**
 * Оцінка маржі замовлення — щоб торговий бачив прибуток ДО відвантаження.
 *
 * Навіщо. Собівартість приходить із 1С лише разом із реалізацією: регістр
 * ПродажиСебестоимость наповнюється в момент списання партій. Виміряно: з
 * 11 935 рядків замовлень собівартість має РІВНО НУЛЬ. Тому в момент, коли
 * менеджер вирішує дати знижку, маржі він не бачить — а це саме той момент,
 * коли рішення ще можна змінити.
 *
 * Звідки берeмо. Собівартість останньої реалізації того самого товару:
 * 3 193 з 3 196 товарів у замовленнях (99,9%) колись уже відвантажувались,
 * тож оцінка є майже завжди.
 *
 * ЧОМУ ЦЕ ОЦІНКА, А НЕ ФАКТ — і чому так підписано в інтерфейсі:
 *   - партія могла подорожчати після останнього продажу;
 *   - товар може поїхати з іншої партії, ніж попередній;
 *   - для 3 товарів історії немає взагалі.
 * Тому поле зветься `estimated`, поруч завжди йде `costKnown`, і фактичну
 * маржу лишається дивитися в реалізації. Показувати оцінку як факт було б
 * гірше, ніж не показувати нічого: на неї спиралися б у розрахунках.
 */

import { prisma } from "@/lib/prisma";

export type OrderMarginLine = {
  productId: string;
  name: string;
  quantity: number;
  sellingPrice: number;
  /** Оцінка собівартості за одиницю; null — товар ніколи не відвантажувався. */
  estimatedCost: number | null;
  /** Виручка рядка. */
  amount: number;
  /** Оцінка валу рядка; null разом із estimatedCost. */
  estimatedProfit: number | null;
  /** Рентабельність рядка, %. */
  marginPct: number | null;
  /** Коли товар останній раз відвантажувався — вік оцінки. */
  costFrom: string | null;
};

export type OrderMargin = {
  documentId: string;
  number: string;
  amount: number;
  /** Оцінка валу по рядках, де собівартість відома. */
  estimatedProfit: number;
  /** Виручка рядків із відомою собівартістю — знаменник відсотка. */
  costKnownAmount: number;
  marginPct: number | null;
  /** Частка виручки з відомою собівартістю, %. */
  coverage: number;
  /** Рядки, для яких оцінки немає — їх треба показати окремо. */
  unknownLines: number;
  lines: OrderMarginLine[];
};

type RawLine = {
  productId: string;
  name: string;
  quantity: number;
  sellingPrice: number;
  estimatedCost: number | null;
  costFrom: Date | null;
};

/**
 * Оцінка маржі одного замовлення.
 *
 * Собівартість береться з ОСТАННЬОЇ реалізації товару (DISTINCT ON + ORDER BY
 * createdAt DESC), а не з середньої: середня по року розмиває подорожчання,
 * а менеджера цікавить, скільки товар коштує зараз.
 */
export async function orderMargin(documentId: string): Promise<OrderMargin | null> {
  const [doc] = await prisma.$queryRaw<Array<{ id: string; number: string; totalAmount: number }>>`
    SELECT id, number, "totalAmount"::float AS "totalAmount"
    FROM "SalesDocument"
    WHERE id = ${documentId}
    LIMIT 1
  `;
  if (!doc) return null;

  const lines = await prisma.$queryRaw<RawLine[]>`
    WITH last_cost AS (
      -- Остання відома собівартість кожного товару. Рядки з нулем відсіяні:
      -- нуль означає «обмін не привіз», а не «безкоштовно».
      SELECT DISTINCT ON (i."productId")
        i."productId",
        i."purchasePrice" AS cost,
        s."createdAt" AS "from"
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE s."docType" = 'REALIZATION' AND s.status = 'CONFIRMED'
        AND s."externalId" IS NOT NULL AND i."purchasePrice" > 0
      ORDER BY i."productId", s."createdAt" DESC
    )
    SELECT
      i."productId",
      p.name,
      i.quantity::float AS quantity,
      i."sellingPrice"::float AS "sellingPrice",
      lc.cost::float AS "estimatedCost",
      lc."from" AS "costFrom"
    FROM "SalesDocumentItem" i
    JOIN "Product" p ON p.id = i."productId"
    LEFT JOIN last_cost lc ON lc."productId" = i."productId"
    WHERE i."salesDocumentId" = ${documentId}
    ORDER BY (i.quantity * i."sellingPrice") DESC
  `;

  let estimatedProfit = 0;
  let costKnownAmount = 0;
  let unknownLines = 0;
  let amount = 0;

  const mapped: OrderMarginLine[] = lines.map((l) => {
    const lineAmount = l.quantity * l.sellingPrice;
    amount += lineAmount;

    if (l.estimatedCost === null) {
      unknownLines++;
      return {
        productId: l.productId,
        name: l.name,
        quantity: l.quantity,
        sellingPrice: l.sellingPrice,
        estimatedCost: null,
        amount: lineAmount,
        estimatedProfit: null,
        marginPct: null,
        costFrom: null,
      };
    }

    const profit = (l.sellingPrice - l.estimatedCost) * l.quantity;
    estimatedProfit += profit;
    costKnownAmount += lineAmount;

    return {
      productId: l.productId,
      name: l.name,
      quantity: l.quantity,
      sellingPrice: l.sellingPrice,
      estimatedCost: l.estimatedCost,
      amount: lineAmount,
      estimatedProfit: profit,
      marginPct: lineAmount > 0 ? (profit / lineAmount) * 100 : null,
      costFrom: l.costFrom ? l.costFrom.toISOString() : null,
    };
  });

  return {
    documentId: doc.id,
    number: doc.number,
    amount,
    estimatedProfit,
    costKnownAmount,
    marginPct: costKnownAmount > 0 ? (estimatedProfit / costKnownAmount) * 100 : null,
    coverage: amount > 0 ? (costKnownAmount / amount) * 100 : 0,
    unknownLines,
    lines: mapped,
  };
}
