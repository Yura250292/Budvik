import { SITE_URL, SITE_NAME, SITE_CONTACTS, absoluteUrl, stripHtml } from "@/lib/seo/site";

/**
 * Будівники JSON-LD. Кожен повертає простий об'єкт — на сторінку він
 * потрапляє через <JsonLd data={...} />.
 *
 * Product/Offer — головний: без нього Google не показує ціну й наявність у
 * видачі і не бере товар у безкоштовну вкладку «Покупки».
 */

interface ProductForJsonLd {
  name: string;
  slug: string;
  sku: string | null;
  description: string;
  price: number;
  isPromo: boolean;
  promoPrice: number | null;
  stock: number;
  image: string | null;
  brand: { name: string } | null;
}

export function productJsonLd(p: ProductForJsonLd) {
  const price = p.isPromo && p.promoPrice ? p.promoPrice : p.price;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    url: absoluteUrl(`/catalog/${p.slug}`),
    ...(p.image ? { image: p.image } : {}),
    ...(p.sku ? { sku: p.sku } : {}),
    ...(p.brand ? { brand: { "@type": "Brand", name: p.brand.name } } : {}),
    description: stripHtml(p.description).slice(0, 500) || p.name,
    offers: {
      "@type": "Offer",
      url: absoluteUrl(`/catalog/${p.slug}`),
      priceCurrency: "UAH",
      price: price.toFixed(2),
      itemCondition: "https://schema.org/NewCondition",
      availability:
        p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: SITE_NAME },
    },
  };
}

export function breadcrumbJsonLd(items: { name: string; path?: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      ...(item.path ? { item: absoluteUrl(item.path) } : {}),
    })),
  };
}

/** Магазин у Львові — для локальної видачі й картки в Google Maps. */
export function localBusinessJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "HardwareStore",
    name: SITE_CONTACTS.legalName,
    url: SITE_URL,
    image: absoluteUrl("/logo.png"),
    telephone: SITE_CONTACTS.phone,
    email: SITE_CONTACTS.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: SITE_CONTACTS.street,
      addressLocality: SITE_CONTACTS.city,
      addressCountry: SITE_CONTACTS.country,
    },
    priceRange: "₴",
  };
}

/** Сайт із полем пошуку — дає sitelinks searchbox у видачі. */
export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/catalog?search={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}
