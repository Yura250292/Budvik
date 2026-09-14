/**
 * Товари, на які варто подивитись людині: затверджена ціна стала нижчою за
 * опт (стоїть на підлозі) або «6.МАГАЗИНИ» й опт схожі на різні одиниці.
 * Лише в наявності.
 *
 * GET ?view=approved_below_floor|unit_mismatch&brandId=
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VIEWS: Record<string, Prisma.Sql> = {
  approved_below_floor: Prisma.sql`'approved_below_floor' = ANY(s.flags)`,
  unit_mismatch: Prisma.sql`'unit_mismatch' = ANY(s.flags)`,
};

const LIMIT = 300;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "unit_mismatch";
  const where = VIEWS[view];
  if (!where) return NextResponse.json({ error: "Невідомий розріз" }, { status: 400 });
  const brandId = url.searchParams.get("brandId");

  const rows = await prisma.$queryRaw<
    {
      id: string; name: string; sku: string | null; slug: string; stock: number; brand: string | null;
      price: number; basis: string; wholesale: number | null; retail1C: number | null; approved: number | null;
    }[]
  >`
    SELECT p.id, p.name, p.sku, p.slug, p.stock, b.name AS brand,
           s.price, s.basis::text AS basis, s.wholesale, s."retail1C", a.price AS approved
    FROM "SitePrice" s
    JOIN "Product" p ON p.id = s."productId"
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    LEFT JOIN "ApprovedPrice" a ON a."productId" = p.id
    WHERE p."isActive" AND p.stock > 0 AND ${where}
      ${brandId ? Prisma.sql`AND p."brandId" = ${brandId}` : Prisma.empty}
    ORDER BY p.stock * s.price DESC
    LIMIT ${LIMIT}
  `;

  return NextResponse.json({ view, limit: LIMIT, rows });
}
