/**
 * «Подорожчало те, що беруть ваші клієнти».
 *
 * Навіщо торговому. Він називає клієнту вчорашню ціну, клієнт погоджується,
 * а в накладній інша — і розмова починається з виправдань. Або дзвонить в
 * офіс «чи не змінилась ціна на піну». Раз на ранок у будні — одна подія зі
 * списком позицій, які подорожчали щонайменше на MIN_PCT% і які за пів
 * року брали клієнти саме цього торгового.
 *
 * Історію цін веде сам сайт (recordPriceChanges): обмін переписує ціну на
 * місці, і без власної бази «що було вчора» не знає ніхто. Порівнюємо
 * оптову ціну, коли вона є з обох боків, інакше роздрібну: торговий продає
 * здебільшого оптом, а в частини брендів (POLAX, TOTAL) роздріб похідний
 * від опту й рухається разом із ним.
 *
 * Модуль без next/*: воркер.
 */

import { prisma } from "@/lib/prisma";
import { myClientsCte } from "@/lib/assistant/facts/sql";
import { SOURCE_FILTER } from "@/lib/analytics/facts";
import { isHiddenCategory } from "@/lib/catalog/category-display";
import { kyivDate } from "@/lib/date/kyiv";
import type { ArrivalClient } from "./arrivals";
import { isWeekend, worksToday } from "./call-list";
import { describePriceUp, inDigestWindow, PRICE_HOUR, priceBasis, priceWindow } from "./format";
import { isInternalClient, loadInternalContext, type InternalContext } from "./internal";
import { REP_FEED_TYPES, type FeedEvent } from "./types";

/** Нижче цього — округлення й копійчані перерахунки курсу, не новина. */
export const MIN_PCT = 3;
const BUYER_WINDOW_DAYS = 180;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Один запит: різниця поточних цін із базою — у журнал, і база оновлена.
 *
 * Обидві вставки — CTE одного оператора, тож бачать той самий знімок
 * ProductPriceSeen: зміна не може потрапити в базу, минувши журнал. Перший
 * прохід (база порожня) лише наповнює базу. gen_random_uuid — id рядка
 * журналу; cuid тут не потрібен, рядки ніхто не адресує.
 */
export async function recordPriceChanges(): Promise<{ changes: number; upserted: number }> {
  const [row] = await prisma.$queryRaw<{ changes: number; upserted: number }[]>`
    WITH cur AS (
      SELECT id, price, "wholesalePrice" FROM "Product" WHERE "isActive" AND price > 0
    ),
    ch AS (
      INSERT INTO "ProductPriceChange" ("id", "productId", "oldPrice", "newPrice", "oldWholesale", "newWholesale", "changedAt")
      SELECT gen_random_uuid()::text, cur.id, s.price, cur.price, s."wholesalePrice", cur."wholesalePrice", now()
      FROM cur JOIN "ProductPriceSeen" s ON s."productId" = cur.id
      WHERE abs(cur.price - s.price) >= 0.01
         OR abs(COALESCE(cur."wholesalePrice", 0) - COALESCE(s."wholesalePrice", 0)) >= 0.01
      RETURNING 1
    ),
    up AS (
      INSERT INTO "ProductPriceSeen" ("productId", price, "wholesalePrice", "seenAt")
      SELECT id, price, "wholesalePrice", now() FROM cur
      ON CONFLICT ("productId") DO UPDATE
        SET price = EXCLUDED.price, "wholesalePrice" = EXCLUDED."wholesalePrice", "seenAt" = EXCLUDED."seenAt"
        WHERE abs("ProductPriceSeen".price - EXCLUDED.price) >= 0.01
           OR abs(COALESCE("ProductPriceSeen"."wholesalePrice", 0) - COALESCE(EXCLUDED."wholesalePrice", 0)) >= 0.01
      RETURNING 1
    )
    SELECT (SELECT COUNT(*) FROM ch)::int AS changes, (SELECT COUNT(*) FROM up)::int AS upserted
  `;
  return row ?? { changes: 0, upserted: 0 };
}

export type PriceChangeItem = {
  productId: string;
  name: string;
  sku: string | null;
  basis: "wholesale" | "retail";
  oldValue: number;
  newValue: number;
  pct: number;
  clients: ArrivalClient[];
};

type Row = {
  productId: string;
  name: string;
  sku: string | null;
  categoryName: string | null;
  oldPrice: number;
  newPrice: number;
  oldWholesale: number | null;
  newWholesale: number | null;
  clients: ArrivalClient[] | null;
};

/**
 * Подорожчання за вікно на товарах, які беруть клієнти торгового.
 * Свої (ознака Counterparty.isInternal або назва) — не клієнти, їх відсіяно.
 */
export async function priceChangesForRep(
  repId: string,
  window: { from: Date; to: Date },
  internal?: InternalContext
): Promise<PriceChangeItem[]> {
  const buyersSince = new Date(window.to.getTime() - BUYER_WINDOW_DAYS * DAY_MS);
  const rows = await prisma.$queryRaw<Row[]>`
    WITH ${myClientsCte(repId)},
    ch AS (
      SELECT c."productId",
        (ARRAY_AGG(c."oldPrice" ORDER BY c."changedAt" ASC))[1] AS "oldPrice",
        (ARRAY_AGG(c."newPrice" ORDER BY c."changedAt" DESC))[1] AS "newPrice",
        (ARRAY_AGG(c."oldWholesale" ORDER BY c."changedAt" ASC))[1] AS "oldWholesale",
        (ARRAY_AGG(c."newWholesale" ORDER BY c."changedAt" DESC))[1] AS "newWholesale"
      FROM "ProductPriceChange" c
      WHERE c."changedAt" >= ${window.from} AND c."changedAt" < ${window.to}
      GROUP BY 1
    ),
    buyers AS (
      SELECT i."productId", c.id AS "clientId", c.name AS "clientName", MAX(s."createdAt") AS "lastAt"
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Counterparty" c ON c.id = s."counterpartyId"
      WHERE ${SOURCE_FILTER}
        AND s."docType" = 'REALIZATION'
        AND s."createdAt" >= ${buyersSince}
        AND s."counterpartyId" IN (SELECT id FROM my_clients)
        AND i."productId" IN (SELECT "productId" FROM ch)
      GROUP BY 1, 2, 3
    )
    SELECT p.id AS "productId", p.name, p.sku, cat.name AS "categoryName",
      ch."oldPrice", ch."newPrice", ch."oldWholesale", ch."newWholesale",
      json_agg(json_build_object('id', b."clientId", 'name', b."clientName", 'lastAt', b."lastAt")
               ORDER BY b."lastAt" DESC) AS clients
    FROM ch
    JOIN "Product" p ON p.id = ch."productId"
    LEFT JOIN "Category" cat ON cat.id = p."categoryId"
    JOIN buyers b ON b."productId" = p.id
    WHERE p."isActive"
    GROUP BY p.id, p.name, p.sku, cat.name, ch."oldPrice", ch."newPrice", ch."oldWholesale", ch."newWholesale"
    LIMIT 500
  `;

  const ctx = internal ?? (await loadInternalContext());
  const items: PriceChangeItem[] = [];
  for (const r of rows) {
    if (isHiddenCategory(r.categoryName)) continue;
    const basis = priceBasis(r);
    if (!basis || basis.pct < MIN_PCT) continue;
    const clients = (r.clients ?? []).filter((c) => !isInternalClient(c, ctx));
    if (clients.length === 0) continue;
    items.push({ productId: r.productId, name: r.name, sku: r.sku, ...basis, clients });
  }
  return items.sort((a, b) => b.clients.length - a.clients.length || b.pct - a.pct);
}

export function priceUpDedupKey(day: string, repId: string): string {
  return `${REP_FEED_TYPES.PRICE_UP}:${day}:${repId}`;
}

export async function collectPriceUps(now: Date): Promise<FeedEvent[]> {
  if (!inDigestWindow(now, PRICE_HOUR) || isWeekend(now)) return [];

  const day = kyivDate(now);
  const window = priceWindow(day);
  const any = await prisma.productPriceChange.count({
    where: { changedAt: { gte: window.from, lt: window.to } },
  });
  if (any === 0) return [];

  const reps = await prisma.user.findMany({ where: { role: "SALES" }, select: { id: true } });
  const internal = await loadInternalContext();
  const events: FeedEvent[] = [];

  for (const { id: repId } of reps) {
    const dedupKey = priceUpDedupKey(day, repId);
    const known = await prisma.notification.findUnique({ where: { dedupKey }, select: { id: true } });
    if (known) continue;
    if (!(await worksToday(repId, day))) continue;

    const items = await priceChangesForRep(repId, window, internal);
    if (items.length === 0) continue;

    events.push({
      type: REP_FEED_TYPES.PRICE_UP,
      repId,
      dedupKey,
      relatedId: day,
      target: `/sales/price-changes/${day}`,
      ...describePriceUp(items.map((i) => ({ name: i.name, pct: i.pct }))),
      at: now,
      standalone: true,
    });
  }
  return events;
}
