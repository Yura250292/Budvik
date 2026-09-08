/**
 * Відвідуваність сайту — читання без роутів.
 *
 * Досі ці числа існували лише всередині `/api/admin/site-analytics/*`, і
 * помічник керівника не міг відповісти навіть на «скільки людей було на
 * сайті». Винесено сюди тим самим рухом, що й «хто де зараз»: одне
 * джерело на екран і на помічника, інакше вони почнуть розходитись.
 */

import { prisma } from "@/lib/prisma";

/** Скільки рядків показуємо в кожному рейтингу. */
const TOP_LIMIT = 12;

type TotalsRow = {
  visitors: bigint;
  sessions: bigint;
  page_views: bigint;
  product_views: bigint;
  searches: bigint;
  add_to_carts: bigint;
  orders: bigint;
  phone_clicks: bigint;
};

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);

export type SiteOverview = {
  totals: {
    visitors: number;
    sessions: number;
    pageViews: number;
    productViews: number;
    searches: number;
    addToCarts: number;
    orders: number;
    phoneClicks: number;
    /** Скільки візитів дійшло до замовлення, %. */
    conversion: number;
  };
  timeline: Array<{ day: string; visitors: number; pageViews: number; orders: number }>;
  pages: Array<{ path: string; views: number; visitors: number }>;
  devices: Array<{ device: string; visitors: number }>;
  browsers: Array<{ browser: string; visitors: number }>;
  referrers: Array<{ referrer: string; sessions: number }>;
  cities: Array<{ city: string; visitors: number }>;
  refCodes: Array<{ code: string; name: string | null; visitors: number }>;
  /** Що шукали покупці; `found` — скільки товарів знайшов пошук. */
  searches: Array<{ query: string; searches: number; visitors: number; found: number }>;
};

export async function siteOverview(from: Date, to: Date): Promise<SiteOverview> {
  const [totals, timeline, pages, devices, browsers, referrers, cities, refCodes, searches] =
    await Promise.all([
      prisma.$queryRaw<TotalsRow[]>`
        SELECT
          COUNT(DISTINCT "visitorId")                      AS visitors,
          COUNT(DISTINCT "sessionId")                      AS sessions,
          COUNT(*) FILTER (WHERE "type" = 'page_view')     AS page_views,
          COUNT(*) FILTER (WHERE "type" = 'product_view')  AS product_views,
          COUNT(*) FILTER (WHERE "type" = 'search')        AS searches,
          COUNT(*) FILTER (WHERE "type" = 'add_to_cart')   AS add_to_carts,
          COUNT(*) FILTER (WHERE "type" = 'order_placed')  AS orders,
          COUNT(*) FILTER (WHERE "type" = 'phone_click')   AS phone_clicks
        FROM "SiteEvent"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
      `,

      // Дні — за київською добою, як їх зводить нічний cron: інакше
      // «сьогодні» на графіку розходилося б із SiteDailyStat на три години.
      prisma.$queryRaw<Array<{ day: string; visitors: bigint; page_views: bigint; orders: bigint }>>`
        SELECT
          to_char(("createdAt" AT TIME ZONE 'Europe/Kyiv')::date, 'YYYY-MM-DD') AS day,
          COUNT(DISTINCT "visitorId")                                          AS visitors,
          COUNT(*) FILTER (WHERE "type" = 'page_view')                         AS page_views,
          COUNT(*) FILTER (WHERE "type" = 'order_placed')                      AS orders
        FROM "SiteEvent"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1
        ORDER BY 1
      `,

      prisma.$queryRaw<Array<{ path: string; views: bigint; visitors: bigint }>>`
        SELECT "path" AS path, COUNT(*) AS views, COUNT(DISTINCT "visitorId") AS visitors
        FROM "SiteEvent"
        WHERE "type" = 'page_view' AND "path" IS NOT NULL
          AND "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1
        ORDER BY views DESC
        LIMIT ${TOP_LIMIT}
      `,

      // Пристрій і браузер рахуємо по ВІДВІДУВАЧАХ, а не по подіях:
      // інакше один активний десктопник із сотнею кліків переважив би
      // десяток мобільних, і частка «мобільних» вийшла б заниженою.
      prisma.$queryRaw<Array<{ device: string; visitors: bigint }>>`
        SELECT COALESCE("device", 'unknown') AS device, COUNT(DISTINCT "visitorId") AS visitors
        FROM "SiteEvent"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1
        ORDER BY visitors DESC
      `,

      prisma.$queryRaw<Array<{ browser: string; visitors: bigint }>>`
        SELECT COALESCE("browser", 'інше') AS browser, COUNT(DISTINCT "visitorId") AS visitors
        FROM "SiteEvent"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1
        ORDER BY visitors DESC
        LIMIT ${TOP_LIMIT}
      `,

      prisma.$queryRaw<Array<{ referrer: string; sessions: bigint }>>`
        SELECT "referrer" AS referrer, COUNT(DISTINCT "sessionId") AS sessions
        FROM "SiteEvent"
        WHERE "referrer" IS NOT NULL
          AND "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1
        ORDER BY sessions DESC
        LIMIT ${TOP_LIMIT}
      `,

      prisma.$queryRaw<Array<{ city: string; visitors: bigint }>>`
        SELECT "city" AS city, COUNT(DISTINCT "visitorId") AS visitors
        FROM "SiteEvent"
        WHERE "city" IS NOT NULL
          AND "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1
        ORDER BY visitors DESC
        LIMIT ${TOP_LIMIT}
      `,

      // Переходи за QR торгових: скільки людей привів кожен код.
      prisma.$queryRaw<Array<{ ref_code: string; visitors: bigint; name: string | null }>>`
        SELECT e."refCode" AS ref_code, COUNT(DISTINCT e."visitorId") AS visitors, u."name" AS name
        FROM "SiteEvent" e
        LEFT JOIN "User" u ON u."refCode" = e."refCode"
        WHERE e."refCode" IS NOT NULL
          AND e."createdAt" >= ${from} AND e."createdAt" <= ${to}
        GROUP BY 1, 3
        ORDER BY visitors DESC
        LIMIT ${TOP_LIMIT}
      `,

      /**
       * Що шукали покупці — і скільки товарів пошук їм знайшов.
       *
       * Запит із нулем знахідок цінніший за всі перегляди разом: це
       * товар, по який людина прийшла, а ми його не показали.
       */
      prisma.$queryRaw<Array<{ query: string; searches: bigint; visitors: bigint; found: number | null }>>`
        SELECT "query" AS query,
               COUNT(*)                    AS searches,
               COUNT(DISTINCT "visitorId") AS visitors,
               AVG("value")                AS found
        FROM "SiteEvent"
        WHERE "type" = 'search' AND "query" IS NOT NULL
          AND "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY 1
        ORDER BY searches DESC
        LIMIT ${TOP_LIMIT}
      `,
    ]);

  const t = totals[0];
  const sessions = n(t?.sessions);
  const orders = n(t?.orders);

  return {
    totals: {
      visitors: n(t?.visitors),
      sessions,
      pageViews: n(t?.page_views),
      productViews: n(t?.product_views),
      searches: n(t?.searches),
      addToCarts: n(t?.add_to_carts),
      orders,
      phoneClicks: n(t?.phone_clicks),
      conversion: sessions > 0 ? (orders / sessions) * 100 : 0,
    },
    timeline: timeline.map((r) => ({
      day: r.day,
      visitors: n(r.visitors),
      pageViews: n(r.page_views),
      orders: n(r.orders),
    })),
    pages: pages.map((r) => ({ path: r.path, views: n(r.views), visitors: n(r.visitors) })),
    devices: devices.map((r) => ({ device: r.device, visitors: n(r.visitors) })),
    browsers: browsers.map((r) => ({ browser: r.browser, visitors: n(r.visitors) })),
    referrers: referrers.map((r) => ({ referrer: r.referrer, sessions: n(r.sessions) })),
    cities: cities.map((r) => ({ city: r.city, visitors: n(r.visitors) })),
    refCodes: refCodes.map((r) => ({ code: r.ref_code, name: r.name, visitors: n(r.visitors) })),
    searches: searches.map((r) => ({
      query: r.query,
      searches: n(r.searches),
      visitors: n(r.visitors),
      found: Math.round(Number(r.found ?? 0)),
    })),
  };
}

/** Те саме зведення, але українськими ключами — для помічника. */
export async function siteTrafficFacts(from: Date, to: Date) {
  const o = await siteOverview(from, to);
  const empty = o.searches.filter((s) => s.found === 0);

  return {
    разом: {
      відвідувачів: o.totals.visitors,
      сесій: o.totals.sessions,
      переглядів_сторінок: o.totals.pageViews,
      переглядів_товарів: o.totals.productViews,
      пошуків: o.totals.searches,
      додали_в_кошик: o.totals.addToCarts,
      замовлень: o.totals.orders,
      кліків_по_телефону: o.totals.phoneClicks,
      конверсія_відсотків: Math.round(o.totals.conversion * 10) / 10,
    },
    топ_сторінок: o.pages.slice(0, 8).map((p) => ({ сторінка: p.path, переглядів: p.views })),
    звідки_приходять: o.referrers.slice(0, 6).map((r) => ({ джерело: r.referrer, сесій: r.sessions })),
    міста: o.cities.slice(0, 8).map((c) => ({ місто: c.city, відвідувачів: c.visitors })),
    пристрої: o.devices.map((d) => ({ пристрій: d.device, відвідувачів: d.visitors })),
    що_шукали: o.searches.slice(0, 10).map((s) => ({
      запит: s.query,
      разів: s.searches,
      знайшло_товарів: s.found,
    })),
    шукали_й_не_знайшли: empty.slice(0, 8).map((s) => ({ запит: s.query, разів: s.searches })),
    по_qr_торгових: o.refCodes.slice(0, 6).map((r) => ({
      код: r.code,
      торговий: r.name,
      відвідувачів: r.visitors,
    })),
    примітка:
      "Рахуються лише події з браузера покупця: заходи з застосунку сюди не потрапляють.",
  };
}
