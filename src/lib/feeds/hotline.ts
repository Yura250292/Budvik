/**
 * Товарний фід Hotline: відбір позицій і збирання XML.
 *
 * Чому туди їдуть не всі 5,5 тис. товарів у наявності: Hotline бере 7,5 грн
 * за КОЖЕН перехід незалежно від того, купили чи ні. Товар, який заробляє
 * менше, ніж коштує десяток кліків, — гарантований мінус, тож поріг ціни
 * тут не смак, а точка беззбитковості (розрахунок у docs/hotline.md).
 *
 * Логіка в чистих функціях, роут лише віддає зібране: так фід перевіряє
 * scripts/check-hotline-feed.mts, не піднімаючи сервер.
 *
 * Формат: https://hotline.ua/ua/about/pricelists_specs/
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { indexableProductWhere } from "@/lib/seo/indexable";
import { isRealSku } from "@/lib/catalog/sku-search";
import { isHiddenCategory } from "@/lib/catalog/category-display";
import { SECTION_BY_ID, TYPE_LABELS } from "@/lib/catalog/classify";
import { absoluteUrl, escapeXml, stripHtml, SITE_NAME } from "@/lib/seo/site";
import { DELIVERY_TERMS } from "@/lib/delivery-terms";

export const HOTLINE = {
  /** Точка беззбитковості при 7,5 грн за клік — див. docs/hotline.md. */
  minPrice: 2000,
  /**
   * Кріплення й метизи: у рубрикаторі Hotline таких рубрик немає взагалі,
   * тож пропозиції нікуди прив'язати. Кріпіж піде на Епіцентр і Prom, де
   * платимо з продажу, а не з переходу.
   */
  excludeSections: ["krip"] as string[],
  /** Мітка, за якою звіт «Джерела» впізнає переходи з Hotline. */
  utm: "utm_source=hotline&utm_medium=cpc&utm_campaign=feed",
};

export type FeedItem = {
  id: string;
  categoryId: number;
  code: string;
  barcode: string | null;
  vendor: string;
  name: string;
  description: string;
  url: string;
  image: string;
  price: number;
};

export type FeedCategory = { id: number; parentId: number | null; name: string };

/**
 * Id товару для Hotline: до 20 символів, і перевикористати його не можна.
 *
 * Наш cuid має 25 символів, тож беремо стабільний хеш — він не зміниться,
 * поки живий сам товар, і не залежить ані від порядку у вивантаженні, ані
 * від змін у назві чи ціні.
 */
export function feedItemId(productId: string): string {
  const hex = createHash("sha1").update(productId).digest("hex").slice(0, 16);
  return BigInt(`0x${hex}`).toString(36).slice(0, 20);
}

/**
 * Числовий id категорії з її ключа.
 *
 * Саме хеш, а не порядковий номер: новий тип товару зсунув би нумерацію, і
 * зіставлення наших категорій із рубрикатором Hotline довелося б робити
 * заново.
 */
export function categoryId(key: string): number {
  const hex = createHash("sha1").update(key).digest("hex").slice(0, 8);
  return parseInt(hex, 16);
}

/** Ціна вітрини: акційна, якщо діє. Та сама, яку бачить покупець на сайті. */
function shownPrice(p: { price: number; isPromo: boolean; promoPrice: number | null }): number {
  return p.isPromo && p.promoPrice && p.promoPrice < p.price ? p.promoPrice : p.price;
}

export async function loadHotlineFeed(): Promise<{
  items: FeedItem[];
  categories: FeedCategory[];
}> {
  const products = await prisma.product.findMany({
    where: {
      ...indexableProductWhere(),
      // Hotline не вантажить позиції «Немає», а обіцянка наявності, якої
      // немає, — це скарга й зіпсований рейтинг магазину.
      stock: { gt: 0 },
      price: { gte: HOTLINE.minPrice },
      brandId: { not: null },
      sectionId: { notIn: HOTLINE.excludeSections },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      price: true,
      isPromo: true,
      promoPrice: true,
      image: true,
      sku: true,
      barcodes: true,
      sectionId: true,
      typeKey: true,
      brand: { select: { name: true } },
      category: { select: { name: true } },
    },
    orderBy: { id: "asc" },
  });

  const categories = new Map<number, FeedCategory>();
  const items: FeedItem[] = [];

  for (const p of products) {
    // Артикул виробника обов'язковий: внутрішні коди магазину Hotline
    // забороняє, а сурогат «1C-…» саме таким кодом і є.
    if (!isRealSku(p.sku) || !p.brand || !p.sectionId) continue;
    if (isHiddenCategory(p.category?.name)) continue;

    const section = SECTION_BY_ID.get(p.sectionId);
    if (!section) continue;

    const sectionCatId = categoryId(`s:${section.id}`);
    if (!categories.has(sectionCatId)) {
      categories.set(sectionCatId, { id: sectionCatId, parentId: null, name: section.title });
    }

    // Лист дерева — тип товару; без типу товар лишається в категорії розділу.
    let cat = sectionCatId;
    const typeLabel = p.typeKey ? TYPE_LABELS[p.typeKey] : null;
    if (p.typeKey && typeLabel) {
      cat = categoryId(`t:${p.typeKey}`);
      if (!categories.has(cat)) {
        categories.set(cat, { id: cat, parentId: sectionCatId, name: typeLabel });
      }
    }

    items.push({
      id: feedItemId(p.id),
      categoryId: cat,
      code: p.sku!,
      barcode: p.barcodes[0] ?? null,
      vendor: p.brand.name,
      name: p.name,
      description: stripHtml(p.description).slice(0, 1000) || p.name,
      url: `${absoluteUrl(`/catalog/${p.slug}`)}?${HOTLINE.utm}`,
      image: p.image!,
      price: shownPrice(p),
    });
  }

  return { items, categories: [...categories.values()] };
}

export function buildHotlineXml(
  items: FeedItem[],
  categories: FeedCategory[],
  opts: { date: string; firmId: string | null }
): string {
  const cats = categories
    .map(
      (c) =>
        `<category><id>${c.id}</id>${
          c.parentId ? `<parentId>${c.parentId}</parentId>` : ""
        }<name>${escapeXml(c.name)}</name></category>`
    )
    .join("\n");

  const rows = items
    .map(
      (i) => `<item>
<id>${i.id}</id>
<categoryId>${i.categoryId}</categoryId>
<code>${escapeXml(i.code)}</code>${i.barcode ? `\n<barcode>${escapeXml(i.barcode)}</barcode>` : ""}
<vendor>${escapeXml(i.vendor)}</vendor>
<name>${escapeXml(i.name)}</name>
<description>${escapeXml(i.description)}</description>
<url>${escapeXml(i.url)}</url>
<image>${escapeXml(i.image)}</image>
<priceRUAH>${i.price.toFixed(2)}</priceRUAH>
<stock>В наявності</stock>
<condition>0</condition>
<payment type="cash-on-delivery">true</payment>
</item>`
    )
    .join("\n");

  // Доставка — та сама, що на сторінці «Оплата і доставка», у розмітці й у
  // фіді Merchant Center: майданчики звіряють її з тим, що покупець бачить
  // при оформленні.
  const delivery = `<delivery id="3" type="warehouse" carrier="NP" cost="${DELIVERY_TERMS.fee}"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<price>
<date>${opts.date}</date>
<firmName>${escapeXml(SITE_NAME)}</firmName>
<firmId>${opts.firmId ?? ""}</firmId>
${delivery}
<categories>
${cats}
</categories>
<items>
${rows}
</items>
</price>`;
}
