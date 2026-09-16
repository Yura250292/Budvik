/**
 * Посилання в пропозиції: код торгового, куди вести і токен «клієнт відкрив».
 *
 * Формат: `${base}/r/${refCode}?to=/catalog/<slug>&o=<token>`. Через /r/, а
 * не прямо на товар, бо той роут уже вміє головне — поставити куку торгового
 * (budvik_ref), тож клієнт, який зареєструється з цього посилання, закріпиться
 * за тим, хто йому писав. Токен окремий від коду: код один на торгового, а
 * відкриття треба зарахувати конкретному повідомленню.
 *
 * Без next/* і без Prisma — модуль імпортують і роут /r/[code], і скрипти.
 */

import { randomBytes } from "crypto";

/** 12 байт → 16 знаків base64url: 96 біт, угадати чужий токен нереально. */
export function newLinkToken(): string {
  return randomBytes(12).toString("base64url");
}

/** Токен з адреси: лише base64url розумної довжини — сміття в запит до бази не пускаємо. */
export const LINK_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function isLinkToken(v: unknown): v is string {
  return typeof v === "string" && LINK_TOKEN_RE.test(v);
}

/**
 * Куди дозволено вести з /r/: каталог або картка товару.
 *
 * Будь-що інше — відкритий редірект: посилання з нашим доменом, яке веде на
 * чужий сайт, — готовий фішинг від імені Budvik. Тому білий список, а не
 * «починається з /».
 */
export const CATALOG_TARGET_RE = /^\/catalog(\/[\w-]+)?$/;

export function safeCatalogTarget(to: string | null | undefined): string {
  return to && CATALOG_TARGET_RE.test(to) ? to : "/catalog";
}

/**
 * Домен для посилань — з NEXTAUTH_URL, а не з origin запиту.
 *
 * Та сама причина, що в /api/sales/ref-code: у WebView планшета origin буває
 * внутрішньою адресою, і клієнт отримав би посилання, яке в нього не
 * відкривається.
 */
export function outreachBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "").replace(/\/+$/, "");
}

export function buildOfferLink(input: {
  base: string;
  refCode: string;
  slug?: string | null;
  token: string;
}): string {
  const to = input.slug && CATALOG_TARGET_RE.test(`/catalog/${input.slug}`) ? `/catalog/${input.slug}` : null;
  // `to` не кодуємо: слеші в значенні параметра дозволені, а %2F у
  // повідомленні виглядає як зламане посилання і довше на 4 знаки.
  const query = to ? `to=${to}&o=${input.token}` : `o=${input.token}`;
  return `${input.base}/r/${input.refCode}?${query}`;
}

/**
 * Хто відкриває посилання не як людина.
 *
 * Telegram, WhatsApp і соцмережі тягнуть сторінку, щоб намалювати прев'ю, у
 * ту саму секунду, коли торговий натиснув «Надіслати». Без цього фільтра
 * кожне повідомлення виглядало б відкритим ще до того, як клієнт узяв
 * телефон, і «клієнт відкрив» не означало б нічого.
 */
const PREVIEW_AGENT =
  /(bot|crawl|spider|preview|facebookexternalhit|whatsapp|telegram|viber|slack|discord|skype|curl|wget|python-requests|headless)/i;

export function isPreviewAgent(userAgent: string | null | undefined): boolean {
  return !userAgent || PREVIEW_AGENT.test(userAgent);
}

/**
 * Відкриття раніше за цю межу після збереження не рахуємо.
 *
 * Прев'ю Viber тягне пристрій відправника, і назватися він може як
 * звичайний браузер — фільтр за агентом його не впізнає. Жива людина за
 * хвилину після того, як торговий натиснув кнопку, рідко встигає відкрити,
 * а якщо й встигне — наступне відкриття однаково буде зараховане.
 */
export const CLICK_GRACE_MS = 60_000;
