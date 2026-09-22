/**
 * Звіт «Джерела»: звідки приходять покупці й скільки з них купує.
 *
 * Візити рахуються за подією, а замовлення — за полем у самому замовленні.
 * Асиметрія навмисна: візит належить сесії, а замовлення може статися через
 * тиждень після переходу, і прив'язка до сесії загубила б саме ті покупки,
 * заради яких ми платимо Hotline за клік.
 *
 * Запити живуть тут, а не в роуті: ті самі числа згодом читатиме помічник
 * керівника, і друга реалізація неминуче розійшлася б із цією.
 */

import { prisma } from "@/lib/prisma";
import { peopleOnly, type TrafficView } from "@/lib/webstats/people";

export type SourceRow = {
  source: string;
  sessions: number;
  productViews: number;
  addToCarts: number;
  orders: number;
  revenue: number;
  /** Скільки візитів закінчилося замовленням, %. */
  conversion: number;
  avgCheck: number;
};

type VisitRow = {
  source: string;
  sessions: bigint;
  product_views: bigint;
  add_to_carts: bigint;
};

type OrderRow = { source: string; orders: bigint; revenue: number };

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

/** Подія чи замовлення без джерела: усе, що записано до вересня 2026. */
const UNKNOWN = "невідомо";

export async function sourceReport(
  from: Date,
  to: Date,
  view: TrafficView = "people"
): Promise<{ rows: SourceRow[] }> {
  const people = peopleOnly(view, "e");

  const [visits, orders] = await Promise.all([
    prisma.$queryRaw<VisitRow[]>`
      WITH sessions_in_period AS (
        SELECT DISTINCT e."sessionId"
        FROM "SiteEvent" e
        WHERE e."createdAt" BETWEEN ${from} AND ${to} ${people}
      ),
      -- Першу подію сесії шукаємо БЕЗ межі періоду. Джерело пишеться лише
      -- на ній, а сесія живе 30 хвилин і легко переступає північ: інакше
      -- людина, що прийшла з Hotline о 23:50, а картку відкрила о 00:05,
      -- за фільтром «Сьогодні» ставала б «невідомо» — і звіт занижував би
      -- саме той майданчик, за який ми платимо.
      first_event AS (
        SELECT DISTINCT ON (e."sessionId")
          e."sessionId",
          COALESCE(e."source", ${UNKNOWN}) AS source
        FROM "SiteEvent" e
        WHERE e."sessionId" IN (SELECT "sessionId" FROM sessions_in_period)
        ORDER BY e."sessionId", e."createdAt"
      ),
      per_session AS (
        SELECT e."sessionId",
          bool_or(e."type" = 'product_view') AS pv,
          bool_or(e."type" = 'add_to_cart')  AS atc
        FROM "SiteEvent" e
        WHERE e."createdAt" BETWEEN ${from} AND ${to} ${people}
        GROUP BY e."sessionId"
      )
      SELECT f.source,
        COUNT(*)                      AS sessions,
        COUNT(*) FILTER (WHERE s.pv)  AS product_views,
        COUNT(*) FILTER (WHERE s.atc) AS add_to_carts
      FROM first_event f
      JOIN per_session s ON s."sessionId" = f."sessionId"
      GROUP BY f.source`,
    prisma.$queryRaw<OrderRow[]>`
      SELECT COALESCE("source", ${UNKNOWN})   AS source,
        COUNT(*)                              AS orders,
        COALESCE(SUM("totalAmount"), 0)::float8 AS revenue
      FROM "Order"
      WHERE "createdAt" BETWEEN ${from} AND ${to}
      GROUP BY 1`,
  ]);

  const byOrders = new Map(orders.map((o) => [o.source, o]));
  const byVisits = new Map(visits.map((v) => [v.source, v]));
  const sources = new Set<string>([...byVisits.keys(), ...byOrders.keys()]);

  const rows: SourceRow[] = [...sources].map((source) => {
    const v = byVisits.get(source);
    const o = byOrders.get(source);
    const sessions = n(v?.sessions);
    const ordersCount = n(o?.orders);
    const revenue = n(o?.revenue);
    return {
      source,
      sessions,
      productViews: n(v?.product_views),
      addToCarts: n(v?.add_to_carts),
      orders: ordersCount,
      revenue,
      // Один знак після коми: на десятках візитів другий знак — це вже
      // вигадана точність.
      conversion: sessions > 0 ? Math.round((ordersCount / sessions) * 1000) / 10 : 0,
      avgCheck: ordersCount > 0 ? Math.round(revenue / ordersCount) : 0,
    };
  });

  rows.sort((a, b) => b.sessions - a.sessions || b.orders - a.orders);
  return { rows };
}
