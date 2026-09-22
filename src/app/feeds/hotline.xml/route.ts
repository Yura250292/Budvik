import { loadHotlineFeed, buildHotlineXml } from "@/lib/feeds/hotline";

/** Година кешу — як у фіді Merchant Center; частіше Hotline і не забирає. */
export const revalidate = 3600;

/**
 * Товарний фід для Hotline (https://hotline.ua/ua/about/pricelists_specs/).
 *
 * Окремий роут, а не параметр до фіду Google: у Hotline власний формат
 * замість RSS, і склад інший — там ми платимо за кожен перехід, тож їде
 * лише дорогий товар у наявності (відбір — src/lib/feeds/hotline.ts).
 *
 * Без gzip: ~300 позицій — це кількасот кілобайтів, а стиснення Hotline у
 * вимогах не згадує, на відміну від Merchant Center.
 */
export async function GET() {
  const { items, categories } = await loadHotlineFeed();

  // Київський час у форматі специфікації: «2026-09-22 10:00». sv-SE дає
  // рівно ISO-подібний вигляд без ручного складання рядка.
  const date = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Kyiv" }).slice(0, 16);

  const xml = buildHotlineXml(items, categories, {
    date,
    // Номер магазину видає Hotline після реєстрації; до того тег порожній,
    // і фід усе одно можна показати на перевірку.
    firmId: process.env.HOTLINE_FIRM_ID ?? null,
  });

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
