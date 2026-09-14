/**
 * Ціна вітрини — чиста математика, без бази й без мережі.
 *
 * Правило власника (14.09.2026): роздріб на сайті = опт 1С + 25–30 %, і ціна
 * має бути конкурентною з сайтами виробників. Звідси дві межі:
 *
 *   - ціль — опт × markup (типово +30 %): так стоїть товар, поки ринок не
 *     дешевший;
 *   - підлога — опт × minMarkup (типово +25 %): нижче не опускаємось навіть
 *     заради ринку.
 *
 * Якщо на сайті виробника товар дешевший за ціль, ціна опускається до
 * ринкової, але не нижче підлоги. Дорожчий ринок ціну не піднімає: ціль —
 * стеля, а запас лише позначається (market_room), щоб рішення прийняла людина.
 *
 * Чому «6.МАГАЗИНИ» більше не ціна вітрини: клієнти в 1С купують рівно за
 * «4.ОПТ» (96–99 % рядків реалізацій за 60 днів), а роздрібний тип ведуть
 * нерегулярно — у STIHL він на 4 % вищий за опт, у Grösser на 11 %, у STREND
 * PRO на 46 %. Він лишається у двох ролях: ціна, коли опту в 1С немає, і
 * сторож одиниць виміру (див. UNIT_RATIO_*).
 */
import type { SitePriceBasis } from "@prisma/client";

export type PricePolicyValues = {
  /** Ціль: опт × markup. 1,30 = +30 %. */
  markup: number;
  /** Підлога: нижче опт × minMarkup не опускаємось. 1,25 = +25 %. */
  minMarkup: number;
  /** Чи опускати ціну до ринкової, коли на сайті виробника дешевше. */
  followMarket: boolean;
};

/** Типове правило, поки в базі немає рядка PricePolicy «default». */
export const DEFAULT_POLICY: PricePolicyValues = { markup: 1.3, minMarkup: 1.25, followMarket: true };

/** Межі націнки в адмінці: нижче опту не продаємо, утричі — вже одруківка. */
export const MARKUP_MIN = 1;
export const MARKUP_MAX = 3;

/**
 * Сторож одиниць виміру.
 *
 * Коли «6.МАГАЗИНИ» і «4.ОПТ» різняться в рази, це не націнка, а різні
 * одиниці: ліска FORESTA — 5,75 ₴ за метр проти 1064,62 ₴ за бухту. Рахувати
 * з опту тут означає поставити ціну бухти на метр або навпаки, тож такий
 * товар лишається на ціні 1С і йде в список «перевірити одиниці».
 */
export const UNIT_RATIO_LOW = 0.5;
export const UNIT_RATIO_HIGH = 2.5;

/**
 * Ринкова ціна, яка відрізняється від опту в рази, — не той товар: набір
 * замість штуки, упаковка замість одиниці. Таку не беремо до уваги.
 */
export const MARKET_RATIO_LOW = 0.5;
export const MARKET_RATIO_HIGH = 5;

/** Ринок дорожчий за ціль більш ніж на 10 % — позначаємо запас. */
export const MARKET_ROOM = 1.1;

/** Нижче цього порогу ціну тримаємо з копійками (кліпси по 0,42 ₴). */
export const WHOLE_HRYVNIA_FROM = 10;

export type SitePriceFlag =
  /** Ринок дешевший навіть за підлогу: ми дорожчі за сайт виробника. */
  | "above_market"
  /** Ринок дорожчий за ціль більш ніж на 10 %: є куди підняти. */
  | "market_room"
  /** «6.МАГАЗИНИ» і опт різняться в рази — схоже на різні одиниці. */
  | "unit_mismatch"
  /** Ринкова ціна не схожа на цей товар (див. MARKET_RATIO_*). */
  | "market_ignored";

export type PriceInputs = {
  wholesale: number | null;
  retail1C: number | null;
  market: { price: number; source: string } | null;
  policy: PricePolicyValues;
};

export type SitePriceResult = {
  /** null — з 1С цін немає, ціну вітрини не чіпаємо. */
  price: number | null;
  basis: SitePriceBasis;
  flags: SitePriceFlag[];
  markup: number | null;
  minMarkup: number | null;
  /** Ринкова ціна, яку взято до уваги (не та, що відкинута). */
  market: number | null;
  marketSource: string | null;
};

const positive = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

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

export function clampMarkup(k: number): number {
  return Math.min(MARKUP_MAX, Math.max(MARKUP_MIN, k));
}

export function computeSitePrice(input: PriceInputs): SitePriceResult {
  const wholesale = positive(input.wholesale);
  const retail1C = positive(input.retail1C);
  const none = { flags: [], markup: null, minMarkup: null, market: null, marketSource: null };

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

  const markup = clampMarkup(input.policy.markup);
  const minMarkup = Math.min(clampMarkup(input.policy.minMarkup), markup);
  const target = roundUah(wholesale * markup);
  const floor = Math.min(roundUah(wholesale * minMarkup, "ceil"), target);
  const flags: SitePriceFlag[] = [];

  let market: number | null = null;
  let marketSource: string | null = null;
  if (input.market) {
    const ratio = input.market.price / wholesale;
    if (ratio < MARKET_RATIO_LOW || ratio > MARKET_RATIO_HIGH) {
      flags.push("market_ignored");
    } else {
      market = input.market.price;
      marketSource = input.market.source;
    }
  }

  const base = { markup, minMarkup, market, marketSource };

  if (market !== null && market < target) {
    if (!input.policy.followMarket) {
      if (market < floor) flags.push("above_market");
      return { price: target, basis: "MARKUP", flags, ...base };
    }
    const matched = roundUah(market, "floor");
    if (matched >= floor) return { price: matched, basis: "MARKET", flags, ...base };
    flags.push("above_market");
    return { price: floor, basis: "FLOOR", flags, ...base };
  }

  if (market !== null && market > target * MARKET_ROOM) flags.push("market_room");
  return { price: target, basis: "MARKUP", flags, ...base };
}
