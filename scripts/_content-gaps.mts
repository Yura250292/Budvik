/**
 * Скільки карток ще без фото й без опису — і скільки з них узагалі можна
 * закрити з сайту виробника.
 *
 * Ключове розрізнення: артикул «1C-…» — це сурогат, який 1С видала позиції
 * без власного артикулу. Такі картки не зіставити з жодним каталогом
 * виробника, скільки джерел не додавай.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

/**
 * «Опису по суті немає»: порожньо, надто коротко, або це відмовка моделі
 * («товар не визначено»).
 *
 * Формулювання прив'язане до початку рядка і до слова «товар/опис/інформація»
 * навмисно: широкий пошук по «відсутн|не містить» ловив нормальні описи
 * виробника («не містить розчинників»), і звіт показував зростання діри там,
 * де її не було.
 */
const WEAK = `(p.description IS NULL OR length(trim(p.description)) < 40
  OR p.description ~* '^[^.]{0,80}(товар|опис|інформац)[^.]{0,60}(відсутн|не визначен|неможлив|не може бути опис|не містить технічних)')`;
const NOPHOTO = `(p.image IS NULL OR p.image = '')`;

const [t]: any[] = await prisma.$queryRawUnsafe(`
  SELECT
    COUNT(*) FILTER (WHERE p."isActive")::int                                   AS active,
    COUNT(*) FILTER (WHERE NOT p."isActive")::int                               AS hidden,
    COUNT(*) FILTER (WHERE p."isActive" AND ${NOPHOTO})::int                    AS no_photo,
    COUNT(*) FILTER (WHERE p."isActive" AND p.stock > 0)::int                   AS in_stock,
    COUNT(*) FILTER (WHERE p."isActive" AND p.stock > 0 AND ${NOPHOTO})::int    AS no_photo_stock,
    COUNT(*) FILTER (WHERE p."isActive" AND ${WEAK})::int                       AS weak_desc,
    COUNT(*) FILTER (WHERE p."isActive" AND p.stock > 0 AND ${WEAK})::int       AS weak_desc_stock,
    COUNT(*) FILTER (WHERE p."isActive" AND ${NOPHOTO} AND ${WEAK})::int        AS neither,
    COUNT(*) FILTER (WHERE p.image LIKE '%/site-2026-%')::int                   AS from_site,
    COUNT(*) FILTER (WHERE p."isActive" AND ${NOPHOTO} AND (p.sku IS NULL OR p.sku ~ '^1C-'))::int AS no_photo_no_sku
  FROM "Product" p`);

const n = (x: number) => String(x).padStart(6);
console.log("КАТАЛОГ");
console.log(`  показуємо покупцю (активні): ${n(t.active)}   з них у наявності: ${n(t.in_stock)}`);
console.log(`  вимкнені картки:             ${n(t.hidden)}`);
console.log("\nФОТО");
console.log(`  без фото, усього активних:   ${n(t.no_photo)}  (${((t.no_photo / t.active) * 100).toFixed(0)}%)`);
console.log(`  без фото і В НАЯВНОСТІ:      ${n(t.no_photo_stock)}  ← це те, що бачить покупець`);
console.log(`  поставлено з сайтів виробників за сьогодні: ${t.from_site}`);
console.log("\nОПИС");
console.log(`  порожній або беззмістовний:  ${n(t.weak_desc)}`);
console.log(`  те саме, але в наявності:    ${n(t.weak_desc_stock)}`);
console.log(`  ні фото, ні опису:           ${n(t.neither)}`);
console.log("\nСТЕЛЯ АВТОЗБОРУ");
console.log(`  без фото і без справжнього артикулу (sku «1C-…» або порожній): ${n(t.no_photo_no_sku)}`);
console.log(`  тобто теоретично зіставні з сайтом виробника: ${n(t.no_photo - t.no_photo_no_sku)}`);

const brands: any[] = await prisma.$queryRawUnsafe(`
  SELECT COALESCE(b.name, '— без бренду —') AS name,
    COUNT(*) FILTER (WHERE p."isActive" AND ${NOPHOTO})::int                 AS no_photo,
    COUNT(*) FILTER (WHERE p."isActive" AND p.stock > 0 AND ${NOPHOTO})::int AS stock,
    COUNT(*) FILTER (WHERE p."isActive" AND ${NOPHOTO} AND p.sku IS NOT NULL AND p.sku !~ '^1C-')::int AS matchable,
    COUNT(*) FILTER (WHERE p."isActive" AND ${WEAK})::int                    AS weak
  FROM "Product" p LEFT JOIN "Brand" b ON b.id = p."brandId"
  GROUP BY 1 HAVING COUNT(*) FILTER (WHERE p."isActive" AND ${NOPHOTO}) > 0
  ORDER BY stock DESC, no_photo DESC LIMIT 20`);
console.log("\nДЕ САМЕ ДІРКИ (топ-20 за «в наявності без фото»)");
console.log("  бренд".padEnd(26), "без фото".padStart(9), "в наявн.".padStart(9), "є артикул".padStart(10), "слабкий опис".padStart(13));
for (const r of brands)
  console.log("  " + String(r.name).slice(0, 24).padEnd(24), n(r.no_photo), n(r.stock), String(r.matchable).padStart(10), String(r.weak).padStart(13));
await prisma.$disconnect();
