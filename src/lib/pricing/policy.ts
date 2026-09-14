/**
 * Правила ціни вітрини: загальне і по брендах (таблиця PricePolicy).
 *
 * Загальне правило — рядок з id «default»; його створює міграція. Правило
 * бренду перекриває загальне цілком (націнка, підлога, знижка від ринку), а
 * не по одному полю: інакше людина в адмінці не бачила б, що саме діє.
 */
import { prisma } from "@/lib/prisma";
import { DEFAULT_POLICY, MARKUP_MAX, UNDERCUT_MAX, type PricePolicyValues } from "./compute";

export const DEFAULT_POLICY_ID = "default";

export type Policies = {
  fallback: PricePolicyValues;
  byBrand: Map<string, PricePolicyValues>;
};

export async function loadPolicies(): Promise<Policies> {
  const rows = await prisma.pricePolicy.findMany({
    select: { id: true, brandId: true, markup: true, minMarkup: true, undercut: true },
  });
  const pick = (r: (typeof rows)[number]): PricePolicyValues => ({
    markup: r.markup,
    minMarkup: r.minMarkup,
    undercut: r.undercut,
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

const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Відсотки з адмінки → коефіцієнти. Рядок — текст помилки для людини. */
export function policyFromPercents(input: {
  markupPct: unknown;
  minMarkupPct: unknown;
  undercutPct: unknown;
}): PricePolicyValues | string {
  const markupPct = Number(input.markupPct);
  const minMarkupPct = Number(input.minMarkupPct);
  const undercutPct = Number(input.undercutPct);
  const hi = Math.round((MARKUP_MAX - 1) * 100);
  const undercutHi = Math.round(UNDERCUT_MAX * 100);

  if (!Number.isFinite(markupPct) || markupPct <= 0 || markupPct > hi) {
    return `Націнка має бути більше 0 і не більше ${hi} %`;
  }
  if (!Number.isFinite(minMarkupPct) || minMarkupPct <= 0 || minMarkupPct > markupPct) {
    return `Підлога має бути більше 0 % — роздріб строго дорожчий за опт — і не вища за націнку (${markupPct} %)`;
  }
  if (!Number.isFinite(undercutPct) || undercutPct < 0 || undercutPct > undercutHi) {
    return `«Дешевше за ринок» має бути від 0 до ${undercutHi} %`;
  }
  return {
    markup: r4(1 + markupPct / 100),
    minMarkup: r4(1 + minMarkupPct / 100),
    undercut: r4(undercutPct / 100),
  };
}
