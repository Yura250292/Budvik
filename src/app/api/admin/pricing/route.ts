/**
 * Ціни вітрини: правила й стан (див. docs/pricing.md).
 *
 * GET   — загальне правило, бренди з розкладом цін за походженням, покриття
 *         ринковими цінами по сайтах.
 * PATCH — { brandId: string | null, markupPct, minMarkupPct, followMarket }
 *         або { brandId, reset: true } — записати правило й одразу
 *         перерахувати ціни: чекати нічного обміну не треба, опт уже в базі.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bustStorefrontCache } from "@/lib/storefront-cache";
import { MARKET_FRESH_DAYS, repriceProducts } from "@/lib/pricing/engine";
import { DEFAULT_POLICY_ID, loadPolicies, policyFromPercents } from "@/lib/pricing/policy";
import type { PricePolicyValues } from "@/lib/pricing/compute";

export const maxDuration = 60;

type Counts = {
  inStock: number;
  priced: number;
  markup: number;
  market: number;
  floor: number;
  retail1C: number;
  withMarket: number;
  unitMismatch: number;
  marketRoom: number;
};

const toPct = (p: PricePolicyValues) => ({
  markupPct: Math.round((p.markup - 1) * 1000) / 10,
  minMarkupPct: Math.round((p.minMarkup - 1) * 1000) / 10,
  followMarket: p.followMarket,
});

async function staff(roles: string[]) {
  const session = await getServerSession(authOptions);
  return session && roles.includes(session.user.role) ? session : null;
}

export async function GET() {
  if (!(await staff(["ADMIN", "MANAGER"]))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const freshFrom = new Date(Date.now() - MARKET_FRESH_DAYS * 86_400_000);
  const inStock = `p."isActive" AND p.stock > 0`;
  const counts = `
    COUNT(*) FILTER (WHERE ${inStock})::int AS "inStock",
    COUNT(s."productId") FILTER (WHERE ${inStock})::int AS "priced",
    COUNT(*) FILTER (WHERE ${inStock} AND s.basis = 'MARKUP')::int AS "markup",
    COUNT(*) FILTER (WHERE ${inStock} AND s.basis = 'MARKET')::int AS "market",
    COUNT(*) FILTER (WHERE ${inStock} AND s.basis = 'FLOOR')::int AS "floor",
    COUNT(*) FILTER (WHERE ${inStock} AND s.basis = 'RETAIL_1C')::int AS "retail1C",
    COUNT(*) FILTER (WHERE ${inStock} AND s.market IS NOT NULL)::int AS "withMarket",
    COUNT(*) FILTER (WHERE ${inStock} AND 'unit_mismatch' = ANY(s.flags))::int AS "unitMismatch",
    COUNT(*) FILTER (WHERE ${inStock} AND 'market_room' = ANY(s.flags))::int AS "marketRoom"`;

  const [policies, brands, totals, sources] = await Promise.all([
    loadPolicies(),
    prisma.$queryRawUnsafe<(Counts & { id: string; name: string })[]>(`
      SELECT b.id, b.name, ${counts}
      FROM "Brand" b
      JOIN "Product" p ON p."brandId" = b.id
      LEFT JOIN "SitePrice" s ON s."productId" = p.id
      GROUP BY b.id, b.name
      HAVING COUNT(*) FILTER (WHERE ${inStock}) > 0
      ORDER BY "inStock" DESC, b.name
    `),
    prisma.$queryRawUnsafe<Counts[]>(`
      SELECT ${counts}
      FROM "Product" p
      LEFT JOIN "SitePrice" s ON s."productId" = p.id
    `),
    prisma.$queryRaw<{ source: string; rows: number; fresh: number; lastSeen: Date | null }[]>`
      SELECT source, COUNT(*)::int AS rows,
             COUNT(*) FILTER (WHERE "seenAt" >= ${freshFrom})::int AS fresh,
             MAX("seenAt") AS "lastSeen"
      FROM "MarketPrice"
      GROUP BY source
      ORDER BY rows DESC
    `,
  ]);

  return NextResponse.json({
    policy: toPct(policies.fallback),
    freshDays: MARKET_FRESH_DAYS,
    totals: totals[0],
    sources,
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
