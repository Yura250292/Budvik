/**
 * Що шукають у каталозі — і чого не знаходять.
 *
 * Друга таблиця (запити з нулем результатів) цінніша за першу: це
 * готовий список того, чого покупці хочуть, а магазин не пропонує. Саме
 * заради нього SearchTracker пише кількість знахідок у value.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod } from "@/lib/analytics/period";

export const dynamic = "force-dynamic";

const LIMIT = 40;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const { from, to, fromDay, toDay } = parsePeriod(searchParams);

  const [top, empty, totals] = await Promise.all([
    prisma.$queryRaw<
      Array<{ query: string; searches: bigint; visitors: bigint; avg_results: number | null; last_at: Date }>
    >`
      SELECT
        "query"                       AS query,
        COUNT(*)                      AS searches,
        COUNT(DISTINCT "visitorId")   AS visitors,
        AVG("value")                  AS avg_results,
        MAX("createdAt")              AS last_at
      FROM "SiteEvent"
      WHERE "type" = 'search' AND "query" IS NOT NULL
        AND "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY 1
      ORDER BY searches DESC
      LIMIT ${LIMIT}
    `,

    prisma.$queryRaw<Array<{ query: string; searches: bigint; visitors: bigint; last_at: Date }>>`
      SELECT
        "query"                       AS query,
        COUNT(*)                      AS searches,
        COUNT(DISTINCT "visitorId")   AS visitors,
        MAX("createdAt")              AS last_at
      FROM "SiteEvent"
      WHERE "type" = 'search' AND "query" IS NOT NULL AND "value" = 0
        AND "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY 1
      ORDER BY searches DESC
      LIMIT ${LIMIT}
    `,

    prisma.$queryRaw<Array<{ searches: bigint; empty: bigint; searchers: bigint }>>`
      SELECT
        COUNT(*)                                  AS searches,
        COUNT(*) FILTER (WHERE "value" = 0)       AS empty,
        COUNT(DISTINCT "visitorId")               AS searchers
      FROM "SiteEvent"
      WHERE "type" = 'search'
        AND "createdAt" >= ${from} AND "createdAt" <= ${to}
    `,
  ]);

  const t = totals[0];
  const searches = Number(t?.searches ?? 0);
  const emptyCount = Number(t?.empty ?? 0);

  return NextResponse.json({
    period: { from: fromDay, to: toDay },
    totals: {
      searches,
      searchers: Number(t?.searchers ?? 0),
      empty: emptyCount,
      emptyShare: searches > 0 ? (emptyCount / searches) * 100 : 0,
    },
    top: top.map((r) => ({
      query: r.query,
      searches: Number(r.searches),
      visitors: Number(r.visitors),
      avgResults: r.avg_results != null ? Math.round(Number(r.avg_results)) : null,
      lastAt: r.last_at,
    })),
    empty: empty.map((r) => ({
      query: r.query,
      searches: Number(r.searches),
      visitors: Number(r.visitors),
      lastAt: r.last_at,
    })),
  });
}
