/**
 * Товари: пошук під питання торгового і мертвий залишок на складі.
 *
 * Обидві відповіді спираються на ВІЛЬНИЙ залишок (LocationStock без
 * сервісних складів), а не на Product.stock. Останній застигає, коли
 * позиція зникає з регістра 1С: заміряно 922 активні товари з ціною, що
 * показували до 844 шт залишку, не маючи жодного рядка на складі.
 * Пообіцяти клієнту такий товар — гірше, ніж не пропонувати нічого.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FREE_STOCK_ALL, LAST_COST, LAST_SALE, myClientsCte } from "@/lib/assistant/facts/sql";
import { searchPatterns, stem } from "@/lib/assistant/facts/search-words";
import { SECTION_BY_ID, SECTIONS } from "@/lib/catalog/classify";

export type ProductHit = {
  productId: string;
  name: string;
  sku: string | null;
  brand: string | null;
  typeKey: string | null;
  sectionId: string | null;
  price: number;
  wholesalePrice: number | null;
  free: number;
  lastCost: number | null;
  lastSale: Date | null;
  myBuyers: number;
};

/**
 * Пошук товару за назвою, артикулом або штрихкодом.
 *
 * Порядок збігів: спершу точний артикул, далі — товари з ціною, далі — за
 * вільним залишком. Торговий питає про товар тоді, коли збирається його
 * продати, тож позиція без ціни або без залишку у відповіді нижча.
 *
 * Позиції з нульовою ціною не ховаємо: їх у базі сотні (тип цін
 * «6.МАГАЗИНИ» заповнений не для всіх брендів), і мовчазне «нічого не
 * знайдено» на товар, який торговий тримає в руках, гірше за чесне
 * «ціни в 1С немає».
 */
export async function searchProducts(
  query: string,
  repId: string,
  limit = 8
): Promise<ProductHit[]> {
  const rows = await searchProductsOnce(query, repId, limit, 0);
  /**
   * Друга спроба з коротшою основою.
   *
   * «Що беруть разом із кругами Ataman» не знаходило нічого: основа
   * «круга» не збігається з «Круг». Те саме, що з клієнтами (див.
   * client-search.ts), і так само лише тоді, коли перша спроба порожня —
   * коротка основа сама по собі знаходить пів каталогу.
   */
  if (rows.length > 0) return rows;
  return searchProductsOnce(query, repId, limit, 1);
}

async function searchProductsOnce(
  query: string,
  repId: string,
  limit: number,
  cut: number
): Promise<ProductHit[]> {
  // Послівно й по основах: питають «скільки ще піни Soma fix», а в базі
  // «SOMA FIX Піна монтажна…». Див. search-words.ts.
  const patterns = searchPatterns(query, 6, cut);
  const like = `%${query.replace(/[%_]/g, "")}%`;

  return prisma.$queryRaw<ProductHit[]>`
    WITH ${LAST_COST}, ${LAST_SALE}, ${FREE_STOCK_ALL}, ${myClientsCte(repId)},
    my_buyers AS (
      SELECT i."productId", COUNT(DISTINCT s."counterpartyId")::int AS n
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."docType" = 'REALIZATION'
        AND s."counterpartyId" IN (SELECT id FROM my_clients)
      GROUP BY 1
    )
    SELECT
      p.id AS "productId", p.name, p.sku, b.name AS brand,
      p."typeKey", p."sectionId",
      p.price::float AS price,
      p."wholesalePrice"::float AS "wholesalePrice",
      COALESCE(fs.free, 0) AS free,
      lc.cost AS "lastCost",
      ls.ts AS "lastSale",
      COALESCE(mb.n, 0) AS "myBuyers"
    FROM "Product" p
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    LEFT JOIN free_stock fs ON fs."productId" = p.id
    LEFT JOIN last_cost lc ON lc."productId" = p.id
    LEFT JOIN last_sale ls ON ls."productId" = p.id
    LEFT JOIN my_buyers mb ON mb."productId" = p.id
    WHERE p."isActive"
      AND (
        p.name ILIKE ALL(${patterns}::text[])
        OR p.sku ILIKE ${like}
        OR ${query} = ANY(p.barcodes)
      )
    ORDER BY (p.sku = ${query}) DESC, (p.price > 0) DESC, COALESCE(fs.free, 0) DESC, p.priority DESC
    LIMIT ${limit}
  `;
}

/**
 * Чим замінити те, чого немає.
 *
 * Питання виникає рівно тоді, коли товар потрібен клієнтові ЗАРАЗ: у
 * відповіді має бути те, що можна відвантажити сьогодні, тож позиції без
 * вільного залишку не показуємо взагалі.
 *
 * Заміна шукається в межах того самого розділу й типу з класифікатора
 * каталогу — це єдина ознака «це те саме, лише інше», яка в нас
 * заповнена. Характеристики (потужність, діаметр) у базі майже порожні,
 * і будувати на них добір означало б вигадувати схожість.
 */
export async function substitutesFor(
  productId: string,
  repId: string,
  limit = 6
): Promise<{ target: ProductHit | null; options: ProductHit[] }> {
  const target = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      sectionId: true,
      typeKey: true,
      brandId: true,
      price: true,
      brand: { select: { name: true } },
    },
  });
  if (!target || (!target.sectionId && !target.typeKey)) return { target: null, options: [] };

  /**
   * Слово-вид із назви — бо самого типу з класифікатора замало.
   *
   * «Піна-клей» лежить у типі «клей», а «Піна монтажна» — у типі «піна»:
   * для класифікатора це різні речі, а для клієнта, якому потрібна піна, —
   * ні. Тому до типу додається слово, з якого починається назва після
   * бренду, і воно ж піднімає справжні аналоги вгору списку.
   */
  const bare = target.brand?.name
    ? target.name.replace(new RegExp(`^${target.brand.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")
    : target.name;
  const firstWord = (bare.match(/[А-Яа-яІіЇїЄєҐґA-Za-z]{4,}/) ?? [])[0] ?? null;
  const kindLike = firstWord ? `%${stem(firstWord)}%` : null;

  const sectionCond = target.sectionId
    ? Prisma.sql`AND p."sectionId" = ${target.sectionId}`
    : Prisma.empty;

  const kinship: Prisma.Sql[] = [];
  if (target.typeKey) kinship.push(Prisma.sql`p."typeKey" = ${target.typeKey}`);
  if (kindLike) kinship.push(Prisma.sql`p.name ILIKE ${kindLike}`);
  const typeCond = kinship.length
    ? Prisma.sql`AND (${Prisma.join(kinship, " OR ")})`
    : Prisma.empty;
  const kindFirst = kindLike
    ? Prisma.sql`(p.name ILIKE ${kindLike}) DESC,`
    : Prisma.empty;

  const options = await prisma.$queryRaw<ProductHit[]>`
    WITH ${LAST_COST}, ${LAST_SALE}, ${FREE_STOCK_ALL}, ${myClientsCte(repId)},
    my_buyers AS (
      SELECT i."productId", COUNT(DISTINCT s."counterpartyId")::int AS n
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."docType" = 'REALIZATION'
        AND s."counterpartyId" IN (SELECT id FROM my_clients)
      GROUP BY 1
    )
    SELECT
      p.id AS "productId", p.name, p.sku, b.name AS brand,
      p."typeKey", p."sectionId",
      p.price::float AS price,
      p."wholesalePrice"::float AS "wholesalePrice",
      COALESCE(fs.free, 0) AS free,
      lc.cost AS "lastCost",
      ls.ts AS "lastSale",
      COALESCE(mb.n, 0) AS "myBuyers"
    FROM "Product" p
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    JOIN free_stock fs ON fs."productId" = p.id AND fs.free > 0
    LEFT JOIN last_cost lc ON lc."productId" = p.id
    LEFT JOIN last_sale ls ON ls."productId" = p.id
    LEFT JOIN my_buyers mb ON mb."productId" = p.id
    WHERE p."isActive" AND p.id <> ${productId} AND p.price > 0
      ${sectionCond} ${typeCond}
    ORDER BY
      -- Спершу той самий вид товару, далі — те, що вже беруть КЛІЄНТИ
      -- ЦЬОГО торгового: знайома позиція продається замість відсутньої,
      -- незнайома — обговорюється.
      ${kindFirst}
      COALESCE(mb.n, 0) DESC,
      ABS(p.price - ${target.price ?? 0}) ASC,
      COALESCE(fs.free, 0) DESC
    LIMIT ${limit}
  `;

  return { target: null, options };
}

export type DeadStockFilters = {
  repId: string;
  brand?: string | null;
  section?: string | null;
  typeKey?: string | null;
  /** Лише те, що вже брав хтось із клієнтів цього торгового. */
  boughtByMyClients?: boolean;
  minDays: number;
  limit: number;
};

/**
 * Мертвий залишок: лежить на складі, а продажів немає.
 *
 * Сортування за грошима (залишок × собівартість), а не за днями: сто
 * позицій по одній штуці — це не проблема складу, а одна позиція на
 * 40 тисяч — проблема. Торговому потрібне саме те, що варто зусиль.
 */
export async function deadStockItems(f: DeadStockFilters): Promise<ProductHit[]> {
  const brandCond = f.brand
    ? Prisma.sql`AND b.name ILIKE ${`%${f.brand.replace(/[%_]/g, "")}%`}`
    : Prisma.empty;

  const sectionId = f.section ? resolveSection(f.section) : null;
  const sectionCond = sectionId ? Prisma.sql`AND p."sectionId" = ${sectionId}` : Prisma.empty;
  const typeCond = f.typeKey ? Prisma.sql`AND p."typeKey" = ${f.typeKey}` : Prisma.empty;
  const mineCond = f.boughtByMyClients ? Prisma.sql`AND COALESCE(mb.n, 0) > 0` : Prisma.empty;

  return prisma.$queryRaw<ProductHit[]>`
    WITH ${LAST_COST}, ${LAST_SALE}, ${FREE_STOCK_ALL}, ${myClientsCte(f.repId)},
    my_buyers AS (
      SELECT i."productId", COUNT(DISTINCT s."counterpartyId")::int AS n
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE s."externalId" IS NOT NULL AND s.status = 'CONFIRMED'
        AND s."docType" = 'REALIZATION'
        AND s."counterpartyId" IN (SELECT id FROM my_clients)
      GROUP BY 1
    )
    SELECT
      p.id AS "productId", p.name, p.sku, b.name AS brand,
      p."typeKey", p."sectionId",
      p.price::float AS price,
      p."wholesalePrice"::float AS "wholesalePrice",
      fs.free AS free,
      lc.cost AS "lastCost",
      ls.ts AS "lastSale",
      COALESCE(mb.n, 0) AS "myBuyers"
    FROM "Product" p
    JOIN free_stock fs ON fs."productId" = p.id
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    LEFT JOIN last_cost lc ON lc."productId" = p.id
    LEFT JOIN last_sale ls ON ls."productId" = p.id
    LEFT JOIN my_buyers mb ON mb."productId" = p.id
    WHERE p."isActive"
      AND p."externalId" IS NOT NULL
      AND p.price > 0
      AND fs.free > 0
      AND (ls.ts IS NULL OR ls.ts < NOW() - (${f.minDays} * INTERVAL '1 day'))
      ${brandCond} ${sectionCond} ${typeCond} ${mineCond}
    ORDER BY fs.free * COALESCE(lc.cost, p.price) DESC
    LIMIT ${f.limit}
  `;
}

/** Розділ приймаємо і кодом (osnastka), і назвою («Оснастка»). */
function resolveSection(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (SECTION_BY_ID.has(value)) return value;
  const hit = SECTIONS.find((s) => s.title.toLowerCase().includes(value));
  return hit?.id ?? null;
}

/**
 * Скільки всього по запиту — понад те, що влізло в список.
 *
 * «Скільки ще піни Soma fix» — це питання про ГРУПУ, а не про артикул: у
 * SOMA FIX піни півтора десятка позицій, і торговому потрібна сума, а вже
 * потім розклад по видах. Без цього рядка відповідь із восьми позицій
 * читається як «оце все, що є», хоча це лише верхівка списку.
 */
export async function searchProductsTotals(
  query: string,
  { onlyInStock = true }: { onlyInStock?: boolean } = {}
): Promise<{ positions: number; free: number; noPrice: number }> {
  const patterns = searchPatterns(query);

  const [row] = await prisma.$queryRaw<Array<{ positions: number; free: number; noPrice: number }>>`
    WITH ${FREE_STOCK_ALL}
    SELECT
      COUNT(*)::int AS positions,
      COALESCE(SUM(fs.free), 0)::int AS free,
      COUNT(*) FILTER (WHERE p.price <= 0)::int AS "noPrice"
    FROM "Product" p
    ${onlyInStock ? Prisma.sql`JOIN` : Prisma.sql`LEFT JOIN`} free_stock fs ON fs."productId" = p.id
    WHERE p."isActive"
      AND p.name ILIKE ALL(${patterns}::text[])
      ${onlyInStock ? Prisma.sql`AND fs.free > 0` : Prisma.empty}
  `;

  return row ?? { positions: 0, free: 0, noPrice: 0 };
}
