/**
 * Ціни вітрини: правила й стан (див. docs/pricing.md).
 *
 * GET   — загальне правило, розклад цін за походженням, джерела ринкових цін,
 *         робота агента-дослідника, бренди.
 * PATCH — { brandId: string | null, markupPct, minMarkupPct, undercutPct }
 *         або { brandId, reset: true } — записати правило й одразу
 *         перерахувати ціни: чекати нічного обміну не треба, опт уже в базі.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bustStorefrontCache } from "@/lib/storefront-cache";
import { repriceProducts } from "@/lib/pricing/engine";
import { DEFAULT_POLICY_ID, loadPolicies, policyFromPercents } from "@/lib/pricing/policy";
import type { PricePolicyValues } from "@/lib/pricing/compute";
import { agentCostUsd } from "@/lib/pricing/agent/cost";
import { RELEVANCE_CTE } from "@/lib/pricing/relevance";

export const maxDuration = 60;

type Counts = {
  inStock: number;
  priced: number;
  markup: number;
  approved: number;
  floor: number;
  retail1C: number;
  unitMismatch: number;
  withMarket: number;
  pending: number;
};

const pct = (x: number) => Math.round(x * 1000) / 10;
const toPct = (p: PricePolicyValues) => ({
  markupPct: pct(p.markup - 1),
  minMarkupPct: pct(p.minMarkup - 1),
  undercutPct: pct(p.undercut),
});

async function staff(roles: string[]) {
  const session = await getServerSession(authOptions);
  return session && roles.includes(session.user.role) ? session : null;
}

const IN_STOCK = `p."isActive" AND p.stock > 0`;
const COUNTS = `
  COUNT(*) FILTER (WHERE ${IN_STOCK})::int AS "inStock",
  COUNT(s."productId") FILTER (WHERE ${IN_STOCK})::int AS "priced",
  COUNT(*) FILTER (WHERE ${IN_STOCK} AND s.basis = 'MARKUP')::int AS "markup",
  COUNT(*) FILTER (WHERE ${IN_STOCK} AND s.basis = 'APPROVED')::int AS "approved",
  COUNT(*) FILTER (WHERE ${IN_STOCK} AND s.basis = 'FLOOR')::int AS "floor",
  COUNT(*) FILTER (WHERE ${IN_STOCK} AND s.basis = 'RETAIL_1C')::int AS "retail1C",
  COUNT(*) FILTER (WHERE ${IN_STOCK} AND 'unit_mismatch' = ANY(s.flags))::int AS "unitMismatch",
  COUNT(*) FILTER (WHERE ${IN_STOCK} AND m."productId" IS NOT NULL)::int AS "withMarket",
  COALESCE(SUM(pp.pending) FILTER (WHERE ${IN_STOCK}), 0)::int AS "pending"`;
const JOINS = `
  LEFT JOIN "SitePrice" s ON s."productId" = p.id
  LEFT JOIN (
    SELECT DISTINCT "productId" FROM "MarketPrice"
    WHERE COALESCE("lastStatus", 'ok') IN ('ok', 'out_of_stock')
  ) m ON m."productId" = p.id
  LEFT JOIN (
    SELECT "productId", COUNT(*) AS pending FROM "PriceProposal" WHERE status = 'PENDING' GROUP BY 1
  ) pp ON pp."productId" = p.id`;

export async function GET() {
  if (!(await staff(["ADMIN", "MANAGER"]))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [policies, brands, totals, sources, agent, coverage] = await Promise.all([
    loadPolicies(),
    prisma.$queryRawUnsafe<(Counts & { id: string; name: string })[]>(`
      SELECT b.id, b.name, ${COUNTS}
      FROM "Brand" b
      JOIN "Product" p ON p."brandId" = b.id
      ${JOINS}
      GROUP BY b.id, b.name
      HAVING COUNT(*) FILTER (WHERE ${IN_STOCK}) > 0
      ORDER BY "inStock" DESC, b.name
    `),
    prisma.$queryRawUnsafe<Counts[]>(`SELECT ${COUNTS} FROM "Product" p ${JOINS}`),
    prisma.$queryRaw<
      { source: string; rows: number; ok: number; outOfStock: number; failing: number; agent: number; lastSeen: Date | null }[]
    >`
      SELECT source,
             COUNT(*)::int AS rows,
             COUNT(*) FILTER (WHERE COALESCE("lastStatus", 'ok') = 'ok')::int AS ok,
             COUNT(*) FILTER (WHERE "lastStatus" = 'out_of_stock')::int AS "outOfStock",
             COUNT(*) FILTER (WHERE COALESCE("lastStatus", 'ok') NOT IN ('ok', 'out_of_stock'))::int AS failing,
             COUNT(*) FILTER (WHERE "foundBy" = 'agent')::int AS agent,
             MAX("seenAt") AS "lastSeen"
      FROM "MarketPrice"
      GROUP BY source
      ORDER BY rows DESC
    `,
    prisma.$queryRaw<
      { looked: number; withPages: number; searches: number; accepted: number; inputTokens: number; outputTokens: number; lastLooked: Date | null }[]
    >`
      SELECT COUNT(*)::int AS looked,
             COUNT(*) FILTER (WHERE "pagesAccepted" > 0)::int AS "withPages",
             COALESCE(SUM(searches), 0)::int AS searches,
             COALESCE(SUM("pagesAccepted"), 0)::int AS accepted,
             COALESCE(SUM("inputTokens"), 0)::float8 AS "inputTokens",
             COALESCE(SUM("outputTokens"), 0)::float8 AS "outputTokens",
             MAX("lookedAt") AS "lastLooked"
      FROM "MarketLookup"
    `,
    // Покриття за актуальністю: для скількох товарів, що продаються, ринкова ціна вже є.
    prisma.$queryRaw<{ tier: number; inStock: number; withMarket: number }[]>`
      WITH ${RELEVANCE_CTE}
      SELECT COALESCE(rel.tier, 4)::int AS tier,
             COUNT(*)::int AS "inStock",
             COUNT(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM "MarketPrice" m
               WHERE m."productId" = p.id AND COALESCE(m."lastStatus", 'ok') IN ('ok', 'out_of_stock')
             ))::int AS "withMarket"
      FROM "Product" p
      LEFT JOIN rel ON rel."productId" = p.id
      WHERE p."isActive" AND p.stock > 0
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  const a = agent[0];
  return NextResponse.json({
    policy: toPct(policies.fallback),
    totals: totals[0],
    sources,
    coverage,
    agent: {
      ...a,
      costUsd: agentCostUsd({ searches: a.searches, inputTokens: a.inputTokens, outputTokens: a.outputTokens }),
    },
    brands: brands.map((b) => {
      const own = policies.byBrand.get(b.id);
      return { ...b, policy: own ? toPct(own) : null };
    }),
  });
}

export async function PATCH(req: Request) {
  const session = await staff(["ADMIN"]);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const brandId: string | null = typeof body.brandId === "string" && body.brandId ? body.brandId : null;

  if (brandId) {
    const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
    if (!brand) return NextResponse.json({ error: "Бренд не знайдено" }, { status: 404 });
  }

  if (body.reset === true) {
    if (!brandId) return NextResponse.json({ error: "Загальне правило скинути не можна" }, { status: 400 });
    await prisma.pricePolicy.deleteMany({ where: { brandId } });
  } else {
    const values = policyFromPercents(body);
    if (typeof values === "string") return NextResponse.json({ error: values }, { status: 400 });
    const data = { ...values, updatedById: session.user.id };
    if (brandId) {
      await prisma.pricePolicy.upsert({ where: { brandId }, create: { ...data, brandId }, update: data });
    } else {
      await prisma.pricePolicy.upsert({
        where: { id: DEFAULT_POLICY_ID },
        create: { ...data, id: DEFAULT_POLICY_ID },
        update: data,
      });
    }
  }

  const result = await repriceProducts(brandId ? { brandId } : { all: true });
  if (result.priceChanged > 0) bustStorefrontCache();

  return NextResponse.json({ ok: true, evaluated: result.evaluated, priceChanged: result.priceChanged });
}
