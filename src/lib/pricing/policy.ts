/**
 * Правила ціни вітрини: загальне і по брендах (таблиця PricePolicy).
 *
 * Загальне правило — рядок з id «default»; його створює міграція. Правило
 * бренду перекриває загальне цілком (націнка, підлога, звірка з ринком), а не
 * по одному полю: інакше людина в адмінці не бачила б, що саме діє.
 */
import { prisma } from "@/lib/prisma";
import { DEFAULT_POLICY, MARKUP_MAX, MARKUP_MIN, type PricePolicyValues } from "./compute";

export const DEFAULT_POLICY_ID = "default";

export type Policies = {
  fallback: PricePolicyValues;
  byBrand: Map<string, PricePolicyValues>;
};

export async function loadPolicies(): Promise<Policies> {
  const rows = await prisma.pricePolicy.findMany({
    select: { id: true, brandId: true, markup: true, minMarkup: true, followMarket: true },
  });
  const pick = (r: (typeof rows)[number]): PricePolicyValues => ({
    markup: r.markup,
    minMarkup: r.minMarkup,
    followMarket: r.followMarket,
  });
  const def = rows.find((r) => r.id === DEFAULT_POLICY_ID);
  return {
    fallback: def ? pick(def) : DEFAULT_POLICY,
    byBrand: new Map(rows.filter((r) => r.brandId).map((r) => [r.brandId!, pick(r)])),
  };
}

export function policyFor(policies: Policies, brandId: string | null): PricePolicyValues {
  return (brandId && policies.byBrand.get(brandId)) || policies.fallback;
}

/** Відсотки з адмінки → коефіцієнти. Рядок — текст помилки для людини. */
export function policyFromPercents(input: {
  markupPct: unknown;
  minMarkupPct: unknown;
  followMarket: unknown;
}): PricePolicyValues | string {
  const markupPct = Number(input.markupPct);
  const minMarkupPct = Number(input.minMarkupPct);
  const lo = Math.round((MARKUP_MIN - 1) * 100);
  const hi = Math.round((MARKUP_MAX - 1) * 100);
  if (!Number.isFinite(markupPct) || markupPct < lo || markupPct > hi) {
    return `Націнка має бути від ${lo} до ${hi} %`;
  }
  if (!Number.isFinite(minMarkupPct) || minMarkupPct < lo || minMarkupPct > markupPct) {
    return `Підлога має бути від ${lo} % і не вища за націнку (${markupPct} %)`;
  }
  return {
    markup: Math.round((1 + markupPct / 100) * 10000) / 10000,
    minMarkup: Math.round((1 + minMarkupPct / 100) * 10000) / 10000,
    followMarket: input.followMarket !== false,
  };
}
