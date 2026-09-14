/**
 * Пропозиції цін від агента: список і рішення адміна (docs/pricing.md).
 *
 * GET  ?status=PENDING|APPROVED|REJECTED&brandId=&flag=
 * POST { action: "approve" | "reject", ids: string[] }
 *      { action: "approve" | "reject", brandId: string }  — усі нові пропозиції бренду
 *      { action: "revert", productIds: string[] }          — зняти затверджену ціну
 *      { action: "rebuild" }                               — скласти пропозиції зараз
 *
 * Затвердження одразу перераховує ціни й скидає кеш вітрини.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bustStorefrontCache } from "@/lib/storefront-cache";
import { approveProposals, rejectProposals, revertApproved } from "@/lib/pricing/agent/decide";
import { buildProposals } from "@/lib/pricing/agent/propose";

export const maxDuration = 60;

const STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
const FLAGS = ["market_below_floor", "only_out_of_stock", "single_source", "big_change", "price_up"];
const LIMIT = 500;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") ?? "PENDING";
  const status = (STATUSES as readonly string[]).includes(statusParam) ? statusParam : "PENDING";
  const brandId = url.searchParams.get("brandId");
  const flag = url.searchParams.get("flag");

  const [rows, counts, brands] = await Promise.all([
    prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT pp.id, pp.status::text AS status, pp."currentPrice", pp."proposedPrice", pp.wholesale,
             pp.market, pp."marketSource", pp."marketUrl", pp.undercut, pp.flags, pp.evidence, pp.week,
             pp."createdAt", pp."decidedAt",
             p.id AS "productId", p.name, p.sku, p.slug, p.stock, b.name AS brand,
             COALESCE(s.price, p.price) AS "livePrice",
             u.name AS "decidedBy",
             (a."proposalId" = pp.id) AS active
      FROM "PriceProposal" pp
      JOIN "Product" p ON p.id = pp."productId"
      LEFT JOIN "Brand" b ON b.id = p."brandId"
      LEFT JOIN "SitePrice" s ON s."productId" = p.id
      LEFT JOIN "ApprovedPrice" a ON a."productId" = p.id
      LEFT JOIN "User" u ON u.id = pp."decidedById"
      WHERE pp.status = ${status}::"PriceProposalStatus"
        ${brandId ? Prisma.sql`AND p."brandId" = ${brandId}` : Prisma.empty}
        ${flag && FLAGS.includes(flag) ? Prisma.sql`AND ${flag} = ANY(pp.flags)` : Prisma.empty}
      ORDER BY ${status === "PENDING" ? Prisma.sql`p.stock * pp.wholesale DESC` : Prisma.sql`pp."decidedAt" DESC NULLS LAST`}
      LIMIT ${LIMIT}
    `,
    prisma.$queryRaw<{ status: string; n: number }[]>`
      SELECT status::text AS status, COUNT(*)::int AS n FROM "PriceProposal"
      WHERE status IN ('PENDING', 'APPROVED', 'REJECTED') GROUP BY 1
    `,
    prisma.$queryRaw<{ id: string; name: string; pending: number }[]>`
      SELECT b.id, b.name, COUNT(*)::int AS pending
      FROM "PriceProposal" pp
      JOIN "Product" p ON p.id = pp."productId"
      JOIN "Brand" b ON b.id = p."brandId"
      WHERE pp.status = 'PENDING'
      GROUP BY b.id, b.name
      ORDER BY pending DESC, b.name
    `,
  ]);

  return NextResponse.json({
    status,
    limit: LIMIT,
    rows,
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    brands,
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === "rebuild") {
    const result = await buildProposals();
    return NextResponse.json({ ok: true, ...result });
  }

  if (action === "revert") {
    const productIds = strings(body.productIds);
    if (productIds.length === 0) return NextResponse.json({ error: "Не вибрано товарів" }, { status: 400 });
    const result = await revertApproved(productIds);
    if (result.priceChanged > 0) bustStorefrontCache();
    return NextResponse.json({ ok: true, ...result });
  }

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Невідома дія" }, { status: 400 });
  }

  let ids = strings(body.ids);
  if (ids.length === 0 && typeof body.brandId === "string" && body.brandId) {
    const rows = await prisma.priceProposal.findMany({
      where: { status: "PENDING", product: { brandId: body.brandId } },
      select: { id: true },
    });
    ids = rows.map((r) => r.id);
  }
  if (ids.length === 0) return NextResponse.json({ error: "Не вибрано пропозицій" }, { status: 400 });

  const result =
    action === "approve" ? await approveProposals(ids, session.user.id) : await rejectProposals(ids, session.user.id);
  if (result.priceChanged > 0) bustStorefrontCache();
  return NextResponse.json({ ok: true, ...result });
}
