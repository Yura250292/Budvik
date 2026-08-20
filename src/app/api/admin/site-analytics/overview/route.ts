/**
 * Зведення вебаналітики: KPI, динаміка по днях і розрізи відвідувачів.
 *
 * Усе одним запитом-роутом, а не п'ятьма: вкладка «Огляд» показує ці
 * блоки разом, і п'ять паралельних викликів serverless коштували б
 * дорожче за один із кількома SELECT.
 *
 * Дні рахуються за київською добою через AT TIME ZONE — так само, як їх
 * зводить нічний cron. Інакше «сьогодні» на графіку розходилося б із
 * SiteDailyStat на три години.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod } from "@/lib/analytics/period";

export const dynamic = "force-dynamic";

/** Скільки рядків показуємо в кожному рейтингу. */
const TOP_LIMIT = 12;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = parsePeriod(searchParams);
  const { from, to } = period;

  const [totals, timeline, pages, devices, browsers, referrers, cities, refCodes] =
    await Promise.all([
      prisma.$queryRaw<
        Array<{
          visitors: bigint;
          sessions: bigint;
          page_views: bigint;
          product_views: bigint;
          searches: bigint;
          add_to_carts: bigint;
          orders: bigint;
          phone_clicks: bigint;
        }>
      >`
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

      prisma.$queryRaw<
        Array<{ day: string; visitors: bigint; page_views: bigint; orders: bigint }>
      >`
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
    ]);

  const t = totals[0];
  const n = (v: bigint | undefined) => Number(v ?? 0);

  const sessions = n(t?.sessions);
  const orders = n(t?.orders);

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    totals: {
      visitors: n(t?.visitors),
      sessions,
      pageViews: n(t?.page_views),
      productViews: n(t?.product_views),
      searches: n(t?.searches),
      addToCarts: n(t?.add_to_carts),
      orders,
      phoneClicks: n(t?.phone_clicks),
      // Скільки візитів дійшло до замовлення. Головне число сторінки:
      // усе решта пояснює, чому воно таке.
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
    refCodes: refCodes.map((r) => ({
      code: r.ref_code,
      name: r.name,
      visitors: n(r.visitors),
    })),
  });
}
