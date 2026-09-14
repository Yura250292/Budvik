/**
 * Реєстр сайтів, з якими звіряємо ціни вітрини.
 *
 * Тут — сайти, для яких відомо, як саме сторінка друкує ціну. Адресу сторінки
 * під кожен товар знаходить обхід сайту виробника (scripts/vendor-catalog/
 * fetch.mts, поле vendorCache каже, чий обхід брати) або агент-дослідник
 * (src/lib/pricing/agent/discover.ts). Для сайтів поза реєстром, які знайшов
 * агент, ціна читається загальним способом (genericOffer).
 *
 * Без ціни на сторінці (перевірено 14.09.2026): sila.com.ua (оптовий сайт),
 * somafix.com.ua, makita.ua. Rozetka відповідає серверним запитам 403.
 */
import {
  firstOffer,
  genericOffer,
  offerFromItemprop,
  offerFromJsonLd,
  offerFromOpenGraph,
  offerFromPriceBlock,
  offerFromProductTag,
  offerFromTitle,
  type MarketOffer,
} from "./extract";

export type MarketSource = {
  /** Хост — він же MarketPrice.source. */
  id: string;
  title: string;
  /** Brand.slug товарів, які звіряємо з цим сайтом. */
  brands: string[];
  /** Сайт закривається JS-перевіркою зі сталою кукою. */
  challenge?: boolean;
  /** Каталог обходу: output/vendor-<vendorCache>/<дата>/pages.jsonl. */
  vendorCache: string;
  /**
   * Бренди, чию сторінку шукаємо за моделлю в заголовку, а не за артикулом.
   * Потрібне, коли сайт продає чужу марку під власними кодами: revolt-tools —
   * імпортер і Grösser, там у нього «G0314», а в 1С артикул — сама модель
   * («GCS 872AB»). Модель має стояти в заголовку окремим словом.
   */
  modelBrands?: string[];
  extract: (html: string) => MarketOffer | null;
};

export const MARKET_SOURCES: MarketSource[] = [
  { id: "apro.ua", title: "APRO", brands: ["apro"], vendorCache: "apro", extract: offerFromItemprop },
  // Під sigma.ua живе і ULTRA: нумерація та сама, каталог спільний.
  { id: "sigma.ua", title: "SIGMA", brands: ["sigma", "ultra"], vendorCache: "ultra", extract: offerFromJsonLd },
  { id: "polax.ua", title: "POLAX", brands: ["polax"], vendorCache: "polax", extract: offerFromJsonLd },
  {
    id: "dnipro-m.ua",
    title: "DNIPRO-M",
    brands: ["dnipro-m"],
    vendorCache: "dnipro-m",
    extract: firstOffer(offerFromJsonLd, offerFromProductTag),
  },
  {
    id: "mastertool.ua",
    title: "MASTERTOOL",
    brands: ["mastertool", "granite", "granite-active", "granite-premium", "tytul", "profi", "kt", "eva", "zak", "ievro", "al", "lan"],
    vendorCache: "mastertool",
    extract: firstOffer(offerFromPriceBlock, offerFromTitle),
  },
  {
    id: "gradient.ua",
    title: "GRADIENT",
    brands: ["gradient", "rhino"],
    challenge: true,
    vendorCache: "gradient",
    extract: firstOffer(offerFromOpenGraph, offerFromItemprop),
  },
  {
    id: "revolt-tools.com.ua",
    title: "REVOLT, Grösser",
    brands: ["revolt", "grosser"],
    modelBrands: ["grosser"],
    challenge: true,
    vendorCache: "revolt",
    extract: firstOffer(offerFromOpenGraph, offerFromItemprop),
  },
];

export function marketSourceById(id: string): MarketSource | undefined {
  return MARKET_SOURCES.find((s) => s.id === id);
}

/** Хост без www — ключ джерела в MarketPrice.source. */
export function hostOf(url: string): string {
  return new URL(url).host.replace(/^www\./, "");
}

/** Як читати ціну з сайту: свій спосіб із реєстру або загальний. */
export function marketExtractorFor(host: string): { extract: (html: string) => MarketOffer | null; challenge: boolean } {
  const known = marketSourceById(host);
  return known ? { extract: known.extract, challenge: Boolean(known.challenge) } : { extract: genericOffer, challenge: false };
}
