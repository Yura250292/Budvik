/**
 * Єдине джерело адреси сайту для SEO: canonical, sitemap, OpenGraph і JSON-LD
 * мають збиратися з однієї константи, інакше Google бачить кілька «різних»
 * сайтів. NEXTAUTH_URL сюди не годиться — у розробці там localhost, і він
 * потрапляв би в canonical прев'ю-збірок.
 */
// Саме з www: Vercel 308-редіректить budvik27.com → www.budvik27.com, і
// canonical/sitemap мають називати кінцеву адресу, а не редірект.
export const SITE_URL = "https://www.budvik27.com";

export const SITE_NAME = "Budvik27";

/** Контакти магазину — ті самі, що показує футер. */
export const SITE_CONTACTS = {
  legalName: "БУДВІК27",
  phone: "+380772700027",
  phoneAlt: "+380932700027",
  email: "budvik27@gmail.com",
  street: "вул. Липинського, 36",
  city: "Львів",
  country: "UA",
};

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Ціна для title/description: 1 234,50 → «1 234,50», ціле — без копійок. */
export function formatUAH(price: number): string {
  return Number.isInteger(price)
    ? price.toLocaleString("uk-UA")
    : price.toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Екранування тексту для XML (sitemap, товарний фід). */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&apos;")
    .replace(/"/g, "&quot;");
}

/** HTML з опису 1С → чистий текст для meta description, JSON-LD і фіда. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&deg;/g, "°")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
