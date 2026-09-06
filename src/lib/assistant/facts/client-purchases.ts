/**
 * Що клієнт брав із названого товару: коли, скільки, почім.
 *
 * Питання «коли Налисник останній раз брав піну і скільки» — одне з
 * найчастіших у полі, і топ-10 товарів у картці на нього не відповідає:
 * піна може бути одинадцятою, а «останній раз» у топі — лише дата, без
 * кількості й ціни. Тому окремий зріз: рядки накладних по товарах, чия
 * назва або артикул збігається зі словом із питання.
 *
 * Період НЕ обмежуємо. Питають саме про «останній раз», а він буває й
 * торік; порожня відповідь на межі в шість місяців виглядала б як «не
 * брав ніколи» і була б неправдою.
 */

import { prisma } from "@/lib/prisma";
import { SOURCE_FILTER } from "@/lib/analytics/facts";
import { Prisma } from "@prisma/client";
import { searchPatterns, stem } from "@/lib/assistant/facts/search-words";
import { uah, ymd } from "@/lib/assistant/format";

type LineRow = {
  productId: string;
  name: string;
  sku: string | null;
  brand: string | null;
  docType: string;
  number: string | null;
  at: Date;
  qty: number;
  price: number;
};

type TotalRow = {
  docs: number;
  qty: number;
  amount: number;
  firstAt: Date | null;
  lastAt: Date | null;
};

/** Останні закупівлі клієнта по товарах, що збігаються із запитом. */
export async function clientProductPurchases(
  counterpartyId: string,
  query: string,
  limit = 12
) {
  /**
   * Спершу СЛОВО, і лише потім підрядок.
   *
   * «Чи брав Левкович дріт» знаходило «віДРІзний диск»: основа «дрі»
   * сидить усередині чужого слова. Та сама пастка, що й у пошуку товару
   * (див. product-facts.ts), і те саме лікування — вимога, щоб основа
   * стояла на початку слова, з відкатом на підрядок, коли інакше порожньо.
   */
  const strict = await purchasesOnce(counterpartyId, query, limit, true);
  if (strict.брав) return strict;

  /**
   * Відкату на підрядок тут НЕМАЄ навмисно.
   *
   * «Чи брав Левкович дріт» на підрядку знаходило «віДРІзний диск» — і
   * відповідь виглядала як «так, брав», хоча дроту він не брав ніколи.
   * Чесне «не брав» дорожче за знайдений хоч щось: на цю відповідь
   * торговий спирається в розмові з клієнтом.
   */
  return strict;
}

async function purchasesOnce(
  counterpartyId: string,
  query: string,
  limit: number,
  strictWord: boolean
) {
  const patterns = searchPatterns(query);
  const like = `%${query.replace(/[%_]/g, "")}%`;
  const first = (query.match(/[А-Яа-яІіЇїЄєҐґA-Za-z]{3,}/) ?? [])[0] ?? "";
  const wordStart = first ? `(^|[^А-Яа-яІіЇїЄєҐґA-Za-z])${stem(first)}` : null;
  const strictCond =
    strictWord && wordStart ? Prisma.sql`AND p.name ~* ${wordStart}` : Prisma.empty;
  const match = { patterns, like };

  const [lines, totals] = await Promise.all([
    prisma.$queryRaw<LineRow[]>`
      SELECT
        i."productId", p.name, p.sku, b.name AS brand,
        s."docType", s.number, s."createdAt" AS at,
        i.quantity::float AS qty,
        i."sellingPrice"::float AS price
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      WHERE ${SOURCE_FILTER}
        AND s."counterpartyId" = ${counterpartyId}
        AND (p.name ILIKE ALL(${match.patterns}::text[]) OR p.sku ILIKE ${match.like})
        ${strictCond}
      ORDER BY s."createdAt" DESC
      LIMIT ${limit}
    `,
    prisma.$queryRaw<TotalRow[]>`
      SELECT
        COUNT(DISTINCT s.id)::int AS docs,
        SUM(i.quantity)::float AS qty,
        SUM(i.quantity * i."sellingPrice")::float AS amount,
        MIN(s."createdAt") AS "firstAt",
        MAX(s."createdAt") AS "lastAt"
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      WHERE ${SOURCE_FILTER}
        AND s."counterpartyId" = ${counterpartyId}
        AND s."docType" <> 'RETURN'
        AND (p.name ILIKE ALL(${match.patterns}::text[]) OR p.sku ILIKE ${match.like})
        ${strictCond}
    `,
  ]);

  const total = totals[0];

  if (lines.length === 0) {
    return { запит: query, брав: false, примітка: "такого товару в накладних цього клієнта немає" };
  }

  return {
    запит: query,
    брав: true,
    разом: {
      документів: total?.docs ?? 0,
      кількість: Math.round(total?.qty ?? 0),
      сума: uah(total?.amount ?? 0),
      перший_раз: ymd(total?.firstAt ?? null),
      останній_раз: ymd(total?.lastAt ?? null),
    },
    рядки: lines.map((l) => ({
      товар_id: l.productId,
      назва: l.name,
      артикул: l.sku,
      бренд: l.brand,
      дата: ymd(l.at),
      вид: l.docType === "RETURN" ? "повернення" : undefined,
      кількість: Math.round(l.qty * 100) / 100,
      ціна: uah(l.price),
      сума: uah(l.qty * l.price),
      накладна: l.number,
    })),
  };
}
