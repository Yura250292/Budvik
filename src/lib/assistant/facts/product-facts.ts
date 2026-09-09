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
import { LETTER, queryWords, stem, wordVariants } from "@/lib/assistant/facts/search-words";
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
  /**
   * Три спроби, від найточнішої до найширшої.
   *
   * Пошук іде підрядком, а підрядок бреше: «пін» сидить усередині
   * «стуПІНчастих свердел» і «кемПІНгу», тож на питання про піну
   * відповідь починалася з набору свердел, у якого якраз був залишок.
   * Тому спершу шукаємо слово — назви, де основа стоїть на початку
   * слова, або товари того самого ВИДУ з класифікатора. І лише коли
   * таких немає взагалі, вертаємось до чесного підрядка: краще показати
   * зайве, ніж «не знайшли» на товар, який лежить на складі.
   */
  const strict = await searchProductsOnce(query, repId, limit, 0, true);
  if (strict.length > 0) return strict;

  const loose = await searchProductsOnce(query, repId, limit, 0, false);
  if (loose.length > 0) return loose;

  return searchProductsOnce(query, repId, limit, 1, false);
}

/**
 * Той самий пошук, але з відкиданням слів з кінця.
 *
 * У живій мові до назви завжди щось прилипає: «дріт для зварювання
 * 0.8 під напівавтомат», «піна SOMA FIX 750 біла». Одне зайве слово в
 * умові AND перетворює справжній товар на «нічого не знайшли», і саме
 * так помічник відповідав на дріт, якого на складі 650 штук.
 *
 * Повертає ще й те, ЗА ЧИМ зрештою шукали: і відповідь кабінету, і
 * модель мусять сказати це вголос, інакше людина побачить список, який
 * не збігається з її запитом, і не зрозуміє чому.
 *
 * Повний запит тут не повторюється: викликають цю функцію лише після
 * того, як `searchProducts` уже повернув порожньо.
 */
export async function searchProductsShorter(
  query: string,
  repId: string,
  limit = 8
): Promise<{ used: string; hits: ProductHit[] } | null> {
  /**
   * Ріжемо по ЗНАЧУЩИХ словах, а не по всьому, що написано.
   *
   * Інакше «дроту для зварювання під напівавтомат» дає спершу «…під», а
   * потім «…зварювання» — два різні рядки, які пошук зводить до тих
   * самих двох слів, тобто зайвий важкий запит на чотирьох CTE. І
   * повідомлення «шукав за» показувало людині рядок, який від її запиту
   * не відрізнити на око.
   *
   * Кожен крок — це до трьох запитів по чотири CTE, тож глибина
   * обмежена: після трьох відкидань від запиту лишається шум, а модель
   * тим часом чекає на відповідь інструмента.
   */
  const parts = queryWords(query);
  const floor = Math.max(1, parts.length - 3);
  for (let take = parts.length - 1; take >= floor; take--) {
    const used = parts.slice(0, take).join(" ");
    const hits = await searchProducts(used, repId, limit);
    if (hits.length > 0) return { used, hits };
  }
  return null;
}

async function searchProductsOnce(
  query: string,
  repId: string,
  limit: number,
  cut: number,
  strict: boolean
): Promise<ProductHit[]> {
  // Послівно й по основах: питають «скільки ще піни Soma fix», а в базі
  // «SOMA FIX Піна монтажна…». Див. search-words.ts.
  /**
   * Умова по словах, а не один ILIKE ALL.
   *
   * Бренди в базі латиницею, а кажуть їх українською: «сома фікс»,
   * «юніфікс», «сігма піна». На кожне слово перевіряємо і кирилицю, і
   * латинку — збігтися має хоч один варіант, але слова між собою
   * лишаються обовʼязковими. Спіймали на голосовому питанні: «SOMA FIX»
   * не знаходився ЖОДНОЮ буквою (07.09.2026).
   */
  const byWord = Prisma.join(
    wordVariants(query, 6, cut).map(
      (variants) =>
        Prisma.sql`(${Prisma.join(
          variants.map((v) => Prisma.sql`p.name ILIKE ${v}`),
          " OR "
        )})`
    ),
    " AND "
  );
  const like = `%${query.replace(/[%_]/g, "")}%`;

  /**
   * Скільки слів запиту збіглися з ЦІЛИМ словом назви, а не з його початком.
   *
   * Основа — це поступка відмінкам, і платимо за неї точністю: від
   * «електроди» лишається «електро», яке з однаковим успіхом сидить в
   * «електропилі» й «електроінструменті», і шина для пили ставала першою
   * відповіддю про електроди.
   *
   * Рахувати збіг слова ДОСЛІВНО не можна — тоді питання в непрямому
   * відмінку карає правильний товар: на «скільки ще піни» дослівне «піни»
   * є в «очищувачі монтажної піни», а в «Піна-клей» його немає, і
   * найходовіша позиція провалюється під аксесуар до неї.
   *
   * Тому міряємо ФОРМУ: основа має стояти від межі слова, і після неї
   * лишається не більше трьох букв — рівно стільки з'їдає закінчення.
   * «Електро» + «ди» — те саме слово, «електро» + «пили» — інше.
   */
  const relevance = relevanceScore(query);

  /**
   * Збіг НА ПОЧАТКУ СЛОВА важить більше за збіг усередині.
   *
   * На «піна» каталог чесно повертав і «Лампочку для кемПІНгу», і скотч
   * «ПІНо-акриловий» — підрядок той самий. Людина ж має на увазі слово,
   * тому спершу показуємо ті назви, де воно окреме, а решту лишаємо
   * нижче: викидати їх не можна, бо саме там ховається «Піна-клей».
   */
  const firstWord = (query.match(new RegExp(`[${LETTER}]{3,}`)) ?? [])[0] ?? "";
  const wordStart = firstWord ? `(^|[^${LETTER}])${stem(firstWord)}` : null;

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
        (${byWord})
        OR p.sku ILIKE ${like}
        OR ${query} = ANY(p.barcodes)
      )
      ${
        strict && wordStart
          ? Prisma.sql`AND (p.name ~* ${wordStart} OR p."typeKey" ~* ${wordStart} OR p.sku ILIKE ${like})`
          : Prisma.empty
      }
    ORDER BY
      (p.sku = ${query}) DESC,
      (${relevance}) DESC,
      -- Далі — те, що можна продати сьогодні: спитали «скільки є», а не
      -- «що це таке».
      (p.price > 0 AND COALESCE(fs.free, 0) > 0) DESC,
      /**
       * Далі — просто залишок.
       *
       * Пробував додати сюди вид із класифікатора, щоб «піна» стояла
       * вище за «піно-акриловий скотч». Вийшло гірше: у типі «піна»
       * лежать і очищувач, і пістолет для піни, зате «Піна-клей» —
       * найходовіша позиція — має тип «клей» і провалилася вниз.
       * Класифікатор для цього завузький.
       */
      COALESCE(fs.free, 0) DESC,
      (p.price > 0) DESC,
      p.priority DESC
    LIMIT ${limit}
  `;
}

const RX_META = /[.*+?^${}()|[\]\\]/g;

/**
 * Наскільки назва відповідає запиту, по кожному слову окремо.
 *
 * Два рівні, і обидва потрібні.
 *
 * Збіг із ПОЧАТКОМ слова (+1) — це «те саме поняття в будь-якій формі»:
 * основа «зварюв» стоїть на початку і «зварювання», і «зварювальний».
 * Самого його замало: «електро» так само починає «електропилу».
 *
 * Збіг із ЦІЛИМ словом (+2) — коли після основи лишилося не більше
 * трьох букв, тобто рівно закінчення. Це й відрізняє «Електроди» від
 * «електропили». Але на довгих суфіксах він не спрацьовує в принципі
 * («зварюв» + «альний» — шість букв), і без першого рівня зварювальний
 * дріт не мав би переваги над будь-яким іншим дротом.
 *
 * Вид товару з класифікатора сюди пробували додати доданком — вийшло
 * гірше, і рівно так само, як колись у сортуванні: у типі «піна» лежить
 * і очищувач монтажної піни, а «Піна-клей» має тип «клей», тож на
 * «скільки ще піни» першим ставав очищувач. Класифікатор для цього
 * завузький, і в релевантності його немає навмисно.
 */
function relevanceScore(query: string): Prisma.Sql {
  const parts = queryWords(query).map((w) => {
    const root = stem(w).replace(RX_META, "\\$&");
    const starts = `(^|[^${LETTER}0-9])${root}`;
    const whole = `${starts}[${LETTER}]{0,3}([^${LETTER}0-9]|$)`;
    return Prisma.sql`(CASE WHEN p.name ~* ${starts} THEN 1 ELSE 0 END)
      + (CASE WHEN p.name ~* ${whole} THEN 2 ELSE 0 END)`;
  });
  return parts.length ? Prisma.join(parts, " + ") : Prisma.sql`0`;
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
  const firstWord = (bare.match(new RegExp(`[${LETTER}]{4,}`)) ?? [])[0] ?? null;
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
  /**
   * Рахуємо ТИМ САМИМ правилом, що й сама вибірка.
   *
   * Доти підсумок ішов по `searchPatterns` з однією основою, а список —
   * по `wordVariants` із трьома спробами. На «що є з масок total» основа
   * «масо» не збігалася з назвою «TOTAL Маска для зварювання», і шапка
   * казала «🔴 немає, 0 позицій» над таблицею з пʼятнадцятьма штуками.
   * Два різні правила на одне питання — це завжди питання часу, коли
   * вони розійдуться.
   */
  const once = await totalsOnce(query, onlyInStock, 0);
  if (once.positions > 0) return once;
  return totalsOnce(query, onlyInStock, 1);
}

async function totalsOnce(
  query: string,
  onlyInStock: boolean,
  cut: number
): Promise<{ positions: number; free: number; noPrice: number }> {
  const byWord = Prisma.join(
    wordVariants(query, 6, cut).map(
      (variants) =>
        Prisma.sql`(${Prisma.join(
          variants.map((v) => Prisma.sql`p.name ILIKE ${v}`),
          " OR "
        )})`
    ),
    " AND "
  );

  const [row] = await prisma.$queryRaw<Array<{ positions: number; free: number; noPrice: number }>>`
    WITH ${FREE_STOCK_ALL}
    SELECT
      COUNT(*)::int AS positions,
      COALESCE(SUM(fs.free), 0)::int AS free,
      COUNT(*) FILTER (WHERE p.price <= 0)::int AS "noPrice"
    FROM "Product" p
    ${onlyInStock ? Prisma.sql`JOIN` : Prisma.sql`LEFT JOIN`} free_stock fs ON fs."productId" = p.id
    WHERE p."isActive"
      AND (${byWord})
      ${onlyInStock ? Prisma.sql`AND fs.free > 0` : Prisma.empty}
  `;

  return row ?? { positions: 0, free: 0, noPrice: 0 };
}
