/**
 * Товари, на які варто подивитись людині: дорожчі за ринок, з підозрою на
 * різні одиниці, опущені до ринку, із запасом до ринку. Лише в наявності.
 *
 * GET ?view=above_market|unit_mismatch|market|market_room&brandId=
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VIEWS: Record<string, Prisma.Sql> = {
  above_market: Prisma.sql`'above_market' = ANY(s.flags)`,
  unit_mismatch: Prisma.sql`'unit_mismatch' = ANY(s.flags)`,
  market: Prisma.sql`s.basis = 'MARKET'`,
  market_room: Prisma.sql`'market_room' = ANY(s.flags)`,
};

const LIMIT = 300;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "above_market";
  const where = VIEWS[view];
  if (!where) return NextResponse.json({ error: "Невідомий розріз" }, { status: 400 });
  const brandId = url.searchParams.get("brandId");

  const rows = await prisma.$queryRaw<
    {
      id: string; name: string; sku: string | null; slug: string; stock: number; brand: string | null;
      price: number; basis: string; wholesale: number | null; retail1C: number | null;
      market: number | null; marketSource: string | null; marketUrl: string | null; flags: string[];
    }[]
  >`
    SELECT p.id, p.name, p.sku, p.slug, p.stock, b.name AS brand,
           s.price, s.basis::text AS basis, s.wholesale, s."retail1C", s.flags,
           COALESCE(s.market, mp.price) AS market, COALESCE(s."marketSource", mp.source) AS "marketSource", mp.url AS "marketUrl"
    FROM "SitePrice" s
    JOIN "Product" p ON p.id = s."productId"
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    LEFT JOIN LATERAL (
      SELECT x.price, x.source, x.url FROM "MarketPrice" x
      WHERE x."productId" = p.id AND (s."marketSource" IS NULL OR x.source = s."marketSource")
      ORDER BY x.price ASC LIMIT 1
    ) mp ON TRUE
    WHERE p."isActive" AND p.stock > 0 AND ${where}
      ${brandId ? Prisma.sql`AND p."brandId" = ${brandId}` : Prisma.empty}
    ORDER BY p.stock * s.price DESC
    LIMIT ${LIMIT}
  `;

  return NextResponse.json({ view, limit: LIMIT, rows });
}
