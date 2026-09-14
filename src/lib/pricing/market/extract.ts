/**
 * Ціна товару зі сторінки чужого сайту.
 *
 * Кожен сайт друкує ціну по-своєму, тож тут набір способів, а який із них
 * брати, вирішує реєстр джерел (sources.ts). Перевірено 14.09.2026 на живих
 * сторінках: apro.ua — мікророзмітка, sigma.ua / polax.ua / dnipro-m.ua —
 * JSON-LD, gradient.ua / revolt-tools.com.ua — Open Graph, mastertool.ua —
 * лише в заголовку сторінки.
 *
 * Модуль без next/* і без бази: його викликає воркер на Railway.
 */

export type MarketOffer = {
  price: number;
  /** null — сайт не каже. */
  inStock: boolean | null;
};

/** «1 652 грн», «15 999.00», «2&nbsp;328», 485 → число гривень. */
export function parseUah(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  let s = value
    .replace(/&nbsp;|&#160;/g, "")
    .replace(/[\s  ]/g, "")
    .replace(/грн\.?|₴|uah/gi, "");
  s = s.includes(",") && s.includes(".") ? s.replace(/,/g, "") : s.replace(/,/g, ".");
  const m = s.match(/^\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function availability(v: unknown): boolean | null {
  const s = String(v ?? "");
  if (/InStock|LimitedAvailability/i.test(s)) return true;
  if (/OutOfStock|SoldOut|Discontinued|PreOrder|BackOrder/i.test(s)) return false;
  return null;
}

/** Перший блок Schema.org Product (включно з @graph) і його пропозиція. */
export function offerFromJsonLd(html: string): MarketOffer | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim().replace(/^﻿/, ""));
    } catch {
      continue;
    }
    const products: Record<string, unknown>[] = [];
    const walk = (o: unknown): void => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) return o.forEach(walk);
      const rec = o as Record<string, unknown>;
      const t = rec["@type"];
      if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) products.push(rec);
      if (rec["@graph"]) walk(rec["@graph"]);
    };
    walk(data);
    for (const product of products) {
      const raw = product.offers;
      const offers = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
      for (const offer of offers) {
        const price = parseUah(offer.price ?? offer.lowPrice);
        if (price !== null) return { price, inStock: availability(offer.availability) };
      }
    }
  }
  return null;
}

/**
 * Перша мікророзмітка itemprop="price".
 *
 * Саме перша: на apro.ua нижче йдуть картки «Схожі товари» з власними цінами
 * в JSON, а мікророзмітка стоїть лише в основного товару.
 */
export function offerFromItemprop(html: string): MarketOffer | null {
  const m =
    html.match(/itemprop=["']price["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/i);
  const price = parseUah(m?.[1]);
  if (price === null) return null;
  const avail = html.match(/itemprop=["']availability["'][^>]*(?:href|content)=["']([^"']+)["']/i)?.[1];
  return { price, inStock: availability(avail) };
}

/** product:price:amount — поточна ціна (стара лежить в original_price). */
export function offerFromOpenGraph(html: string): MarketOffer | null {
  const m =
    html.match(/property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i) ??
    html.match(/content=["']([^"']+)["'][^>]*property=["']product:price:amount["']/i);
  const price = parseUah(m?.[1]);
  return price === null ? null : { price, inStock: null };
}

/** «… ціна 157 грн | MasterTool» у <title>. */
export function offerFromTitle(html: string): MarketOffer | null {
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "";
  const m = title.match(/ціна\s+([\d\s .,]+)\s*грн/i);
  const price = parseUah(m?.[1]);
  return price === null ? null : { price, inStock: null };
}

/**
 * dnipro-m.ua без JSON-LD: частина карток (зокрема ті, яких немає в наявності)
 * не друкує Schema.org, але ціна лежить у пропах Vue-компонента <product :price="525">.
 * Беремо саме цей тег, а не перше «price» на сторінці: вище стоять словники
 * інтерфейсу з рядками на кшталт «delivery.up.price».
 */
export function offerFromProductTag(html: string): MarketOffer | null {
  const at = html.search(/<product\s/i);
  if (at < 0) return null;
  const tag = html.slice(at, at + 400_000);
  const m = tag.match(/\s:?price=(["'])([^"']{1,20})\1/);
  const price = parseUah(m?.[2]);
  return price === null ? null : { price, inStock: null };
}

/**
 * mastertool.ua: ціна в блоці `price-block` під назвою. Перший блок — основний
 * товар; нижче такі самі блоки мають картки «Схожі товари».
 */
export function offerFromPriceBlock(html: string): MarketOffer | null {
  const m = html.match(/class="price-block[^"]*"[^>]*>\s*<div class="price"[^>]*>\s*<span>([\d\s  .,]+)<\/span>/i);
  const price = parseUah(m?.[1]);
  return price === null ? null : { price, inStock: null };
}

export const firstOffer =
  (...ways: ((html: string) => MarketOffer | null)[]) =>
  (html: string): MarketOffer | null => {
    for (const way of ways) {
      const offer = way(html);
      if (offer) return offer;
    }
    return null;
  };

/**
 * Сайт без свого способу — магазин, який знайшов агент: JSON-LD, мікророзмітка,
 * Open Graph. На hotline.ua JSON-LD несе AggregateOffer з lowPrice — мінімум
 * серед магазинів, і offerFromJsonLd бере саме його.
 */
export const genericOffer = firstOffer(offerFromJsonLd, offerFromItemprop, offerFromOpenGraph);
