/**
 * Ціна вітрини — чиста математика, без бази й без мережі.
 *
 * Правило власника, редакція 14.09.2026:
 *
 *   - роздріб ЗАВЖДИ строго дорожчий за опт 1С — дешевше опту товар не
 *     продається, хай що показує ринок і хай що затвердили;
 *   - базова ціна — опт × націнка (типово +30 %);
 *   - конкурентну ціну пропонує агент (src/lib/pricing/agent/), а ставить її
 *     на вітрину лише адмін: затверджена ціна (ApprovedPrice) витісняє базову.
 *
 * Ринок сам ціну більше не рухає. Сайти бувають порожні, з ціною без
 * наявності чи з набором замість штуки — таке рішення має бачити людина
 * разом із джерелом, звідки взято оцінку.
 *
 * «6.МАГАЗИНИ» лишився у двох ролях: ціна, коли опту в 1С немає, і сторож
 * одиниць виміру (див. UNIT_RATIO_*).
 */
import type { SitePriceBasis } from "@prisma/client";

export type PricePolicyValues = {
  /** Базова ціна: опт × markup. 1,30 = +30 %. */
  markup: number;
  /** Підлога: не нижче опт × minMarkup, і в будь-якому разі строго дорожче опту. */
  minMarkup: number;
  /** На скільки агент пропонує стати дешевше за ринок. 0,01 = на 1 %. */
  undercut: number;
};

/** Типове правило, поки в базі немає рядка PricePolicy «default». */
export const DEFAULT_POLICY: PricePolicyValues = { markup: 1.3, minMarkup: 1.01, undercut: 0.01 };

/** Утричі від опту — вже одруківка, а не націнка. */
export const MARKUP_MAX = 3;
/** Стати дешевше ринку більш ніж на 30 % — не конкуренція, а демпінг. */
export const UNDERCUT_MAX = 0.3;

/**
 * Сторож одиниць виміру.
 *
 * Коли «6.МАГАЗИНИ» і «4.ОПТ» різняться в рази, це не націнка, а різні
 * одиниці: ліска FORESTA — 5,75 ₴ за метр проти 1064,62 ₴ за бухту. Рахувати
 * з опту тут означає поставити ціну бухти на метр або навпаки, тож такий
 * товар лишається на ціні 1С, і агент для нього нічого не пропонує.
 */
export const UNIT_RATIO_LOW = 0.5;
export const UNIT_RATIO_HIGH = 2.5;

/**
 * Ринкова ціна, яка відрізняється від опту в рази, — не той товар: набір
 * замість штуки, упаковка замість одиниці. Агент показує її як доказ, але
 * пропозицію з неї не складає.
 */
export const MARKET_RATIO_LOW = 0.5;
export const MARKET_RATIO_HIGH = 5;

/** Нижче цього порогу ціну тримаємо з копійками (кліпси по 0,42 ₴). */
export const WHOLE_HRYVNIA_FROM = 10;

export type SitePriceFlag =
  /** «6.МАГАЗИНИ» і опт різняться в рази — схоже на різні одиниці. */
  | "unit_mismatch"
  /** Опт зріс, і затверджена ціна опинилась нижче підлоги — стоїмо на підлозі. */
  | "approved_below_floor";

export type ApprovedInput = { price: number; market: number | null; marketSource: string | null };

export type PriceInputs = {
  wholesale: number | null;
  retail1C: number | null;
  approved: ApprovedInput | null;
  policy: PricePolicyValues;
};

export type SitePriceResult = {
  /** null — з 1С цін немає, ціну вітрини не чіпаємо. */
  price: number | null;
  basis: SitePriceBasis;
  flags: SitePriceFlag[];
  markup: number | null;
  minMarkup: number | null;
  /** Ринкова ціна, з якої вийшла затверджена (для показу, не для розрахунку). */
  market: number | null;
  marketSource: string | null;
};

const positive = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

const kop = (x: number) => Math.round(x * 100) / 100;

/**
 * Гривня: ціла від 10 ₴, дрібниця — з копійками.
 *
 * Мікрозсув проти шуму плаваючої коми: 250 × 1,25 дає 312,50000000000006, і
 * «вгору» без нього перетворилось би на 313.
 */
export function roundUah(x: number, mode: "round" | "floor" | "ceil" = "round"): number {
  const nudge = mode === "ceil" ? -1e-9 : mode === "floor" ? 1e-9 : 0;
  if (x < WHOLE_HRYVNIA_FROM) return Math[mode]((x + nudge) * 100) / 100;
  return Math[mode](x + nudge);
}

export function normalizePolicy(p: PricePolicyValues): PricePolicyValues {
  const markup = Math.min(MARKUP_MAX, Math.max(1, p.markup));
  return {
    markup,
    minMarkup: Math.min(markup, Math.max(1, p.minMarkup)),
    undercut: Math.min(UNDERCUT_MAX, Math.max(0, p.undercut)),
  };
}

/**
 * Найнижча дозволена ціна: не нижче опт × minMarkup і строго дорожче опту.
 *
 * Друга умова не зайва: при крихітній підлозі округлення до гривні могло б
 * з'їсти націнку, і 300 × 1,001 дало б рівно 300 ₴ — ціну опту.
 */
export function floorPrice(wholesale: number, minMarkup: number): number {
  const byMarkup = roundUah(wholesale * Math.max(1, minMarkup), "ceil");
  const aboveOpt =
    wholesale < WHOLE_HRYVNIA_FROM
      ? kop(Math.floor(wholesale * 100 + 1e-6) / 100 + 0.01)
      : Math.floor(wholesale + 1e-9) + 1;
  return kop(Math.max(byMarkup, aboveOpt));
}

export function computeSitePrice(input: PriceInputs): SitePriceResult {
  const wholesale = positive(input.wholesale);
  const retail1C = positive(input.retail1C);
  const none = { flags: [] as SitePriceFlag[], markup: null, minMarkup: null, market: null, marketSource: null };

  if (wholesale === null) {
    if (retail1C === null) return { price: null, basis: "NONE", ...none };
    return { price: retail1C, basis: "RETAIL_1C", ...none };
  }

  if (retail1C !== null) {
    const ratio = retail1C / wholesale;
    if (ratio < UNIT_RATIO_LOW || ratio > UNIT_RATIO_HIGH) {
      return { price: retail1C, basis: "RETAIL_1C", ...none, flags: ["unit_mismatch"] };
    }
  }

  const { markup, minMarkup } = normalizePolicy(input.policy);
  const floor = floorPrice(wholesale, minMarkup);

  const approvedPrice = positive(input.approved?.price);
  if (input.approved && approvedPrice !== null) {
    const base = { markup, minMarkup, market: input.approved.market, marketSource: input.approved.marketSource };
    if (approvedPrice >= floor) return { price: kop(approvedPrice), basis: "APPROVED", flags: [], ...base };
    return { price: floor, basis: "FLOOR", flags: ["approved_below_floor"], ...base };
  }

  return {
    price: Math.max(roundUah(wholesale * markup), floor),
    basis: "MARKUP",
    flags: [],
    markup,
    minMarkup,
    market: null,
    marketSource: null,
  };
}

/**
 * Ціна, яку агент пропонує з ринкової: на undercut дешевше, округлено вниз,
 * але не нижче підлоги. clamped — ринок дешевший за нашу підлогу.
 */
export function proposePrice(
  wholesale: number,
  market: number,
  policy: PricePolicyValues
): { price: number; floor: number; clamped: boolean } {
  const { minMarkup, undercut } = normalizePolicy(policy);
  const floor = floorPrice(wholesale, minMarkup);
  const raw = roundUah(market * (1 - undercut), "floor");
  return raw >= floor ? { price: raw, floor, clamped: false } : { price: floor, floor, clamped: true };
}
