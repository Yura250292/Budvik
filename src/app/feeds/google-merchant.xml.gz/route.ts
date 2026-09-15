import { gzipSync } from "zlib";
import { prisma } from "@/lib/prisma";
import { indexableProductWhere } from "@/lib/seo/indexable";
import { absoluteUrl, escapeXml, stripHtml, SITE_URL, SITE_NAME, SITE_CONTACTS } from "@/lib/seo/site";
import { DELIVERY_TERMS, deliveryFee } from "@/lib/delivery-terms";
import { isRealSku } from "@/lib/catalog/sku-search";

export const revalidate = 3600;

/**
 * Товарний фід для Google Merchant Center — безкоштовні товарні оголошення
 * у вкладці «Покупки» і товарних блоках видачі.
 *
 * Один файл на ~27 тис. товарів: сирий XML важив би ~25 МБ і впирався б у
 * ліміт відповіді Vercel (4,5 МБ), тому віддаємо gzip — Merchant Center
 * розуміє стиснуті фіди нативно (реєструється як .xml.gz), а розмір падає
 * до ~2 МБ. Склад фіда — той самий indexable-фільтр, що і в sitemap:
 * Merchant вимагає ціну, фото й опис обов'язково.
 */
export async function GET() {
  const products = await prisma.product.findMany({
    where: indexableProductWhere(),
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      price: true,
      isPromo: true,
      promoPrice: true,
      stock: true,
      image: true,
      sku: true,
      brand: { select: { name: true } },
    },
    orderBy: { id: "asc" },
  });

  const items = products.map((p) => {
    const link = absoluteUrl(`/catalog/${p.slug}`);
    const description = stripHtml(p.description).slice(0, 1000) || p.name;
    const hasSalePrice = p.isPromo && p.promoPrice && p.promoPrice < p.price;

    // Доставка за тим самим правилом, що в розмітці й на сторінці доставки:
    // Merchant Center звіряє ціну доставки з оформленням замовлення.
    const t = DELIVERY_TERMS;
    const shipping = `<g:shipping><g:country>${SITE_CONTACTS.country}</g:country><g:price>${deliveryFee(
      hasSalePrice ? p.promoPrice! : p.price
    ).toFixed(2)} UAH</g:price><g:min_handling_time>${t.handlingDays.min}</g:min_handling_time><g:max_handling_time>${t.handlingDays.max}</g:max_handling_time><g:min_transit_time>${t.transitDays.min}</g:min_transit_time><g:max_transit_time>${t.transitDays.max}</g:max_transit_time></g:shipping>`;

    // Без GTIN у базі ідентифікація — бренд + артикул; коли немає і їх,
    // чесно кажемо identifier_exists=no, інакше Merchant бракує позицію.
    const identifiers =
      p.brand && isRealSku(p.sku)
        ? `<g:brand>${escapeXml(p.brand.name)}</g:brand><g:mpn>${escapeXml(p.sku!)}</g:mpn>`
        : `<g:identifier_exists>no</g:identifier_exists>`;

    return `<item>
<g:id>${p.id}</g:id>
<g:title>${escapeXml(p.name.slice(0, 150))}</g:title>
<g:description>${escapeXml(description)}</g:description>
<g:link>${escapeXml(link)}</g:link>
<g:image_link>${escapeXml(p.image!)}</g:image_link>
<g:availability>${p.stock > 0 ? "in_stock" : "out_of_stock"}</g:availability>
<g:price>${p.price.toFixed(2)} UAH</g:price>
${hasSalePrice ? `<g:sale_price>${p.promoPrice!.toFixed(2)} UAH</g:sale_price>\n` : ""}<g:condition>new</g:condition>
${identifiers}
${shipping}
</item>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>${SITE_NAME}</title>
<link>${SITE_URL}</link>
<description>Товарний фід ${SITE_NAME} для Google Merchant Center</description>
${items.join("\n")}
</channel>
</rss>`;

  return new Response(new Uint8Array(gzipSync(Buffer.from(xml, "utf-8"))), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": 'attachment; filename="google-merchant.xml.gz"',
    },
  });
}
