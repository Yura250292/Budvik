/**
 * Що клієнт брав минулого разу і що йому запропонувати наступного.
 *
 * Окремо від clients.ts: там — СТАН портфеля (класифікація, пороги, кольори
 * на карті), тут — ЗМІСТ конкретних замовлень. Теми не пов'язані, а
 * clients.ts і без того тримає всю логіку станів.
 *
 * Рекомендації рахуються детерміновано, правилами нижче, а не моделлю — з
 * тієї ж причини, що й стани клієнтів у clients.ts: торговий має бачити ті
 * самі числа, що й програма, і мати змогу заперечити конкретному правилу.
 * Тому кожна картка несе готове пояснення «чому» — торговому потрібен привід
 * для дзвінка, а не список товарів.
 *
 * ВАЖЛИВО про «групу товарів»: групуємо за БРЕНДОМ, а не за категорією.
 * Заміряно на бойових даних: 23 357 із 27 843 рядків (84%) лежать в одній
 * звалищній категорії «Імпорт з 1С» — рекомендація «раджу групу Імпорт з 1С»
 * була б безглуздою. Бренд покриває 27 075 рядків (97%) при 105 значеннях,
 * тож у цьому домені саме він і є робочою групою товарів.
 */

import { prisma } from "@/lib/prisma";
import { SOURCE_FILTER } from "@/lib/analytics/facts";

const DAY_MS = 86_400_000;

/**
 * Скільки циклів має пройти, щоб товар вважався «пора повторити».
 *
 * 1.2, а не 1.0: цикл рахується з середнього інтервалу, і на межі рівно
 * одного циклу половина товарів потрапляла б у список за день до того, як
 * клієнт і сам би зателефонував. Запас у 20% прибирає цей шум.
 */
const OVERDUE_MIN = 1.2;

/**
 * Понад стільки циклів — це вже не «пора», а «перестав брати».
 *
 * Різні приводи для розмови: у першому випадку торговий нагадує, у другому
 * має з'ясувати, куди клієнт пішов. Тому це не один список, а два.
 */
const OVERDUE_DROPPED = 4;

/** Мінімум схожих клієнтів, щоб бренд потрапив у пораду. */
const PEER_SUPPORT = 3;

/**
 * Скільки спільних брендів роблять клієнта «схожим».
 *
 * Один спільний бренд — не схожість: APRO бере половина бази, і за таким
 * критерієм «схожими» виявилися б усі. Три вже означають збіг профілю
 * закупівель.
 */
const PEER_OVERLAP = 3;

/** Скільки карток показуємо: більше не поміщається в голові перед візитом. */
const MAX_RECOMMENDATIONS = 6;

/**
 * Українська множина: 1 раз, 2 рази, 5 разів.
 *
 * Пояснення читає жива людина перед дзвінком клієнту — «брав 12 раз(и)»
 * одразу видає машинний текст і підриває довіру до самої поради.
 */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

const times = (n: number) => `${n} ${plural(n, "раз", "рази", "разів")}`;
const days = (n: number) => `${n} ${plural(n, "день", "дні", "днів")}`;

export type LastOrderItem = {
  productId: string;
  name: string;
  sku: string | null;
  brand: string | null;
  brandColor: string | null;
  quantity: number;
  sellingPrice: number;
  amount: number;
};

export type LastOrder = {
  id: string;
  number: string;
  docType: string;
  createdAt: string;
  daysAgo: number;
  totalAmount: number;
  /** Сума позицій: може не збігатися з totalAmount, якщо в 1С є знижка на документ */
  itemsAmount: number;
  items: LastOrderItem[];
};

export type RecoReason = "REPLENISH" | "DROPPED" | "SIMILAR_CLIENTS";

export type Recommendation = {
  key: string;
  reason: RecoReason;
  name: string;
  sku: string | null;
  brand: string | null;
  brandColor: string | null;
  price: number | null;
  /** Готовий текст для торгового — чому саме це і саме зараз */
  why: string;
  score: number;
};

type OrderRow = {
  id: string;
  number: string;
  docType: string;
  createdAt: Date;
  totalAmount: number;
  items: LastOrderItem[] | null;
};

/**
 * Останні документи клієнта разом із позиціями.
 *
 * П'ять, а не один: «останнє замовлення» саме по собі не показує, чи це
 * типова покупка, чи разовий виняток — а коштує стільки ж, бо все одно один
 * запит.
 *
 * LIMIT стоїть у CTE, ДО збирання позицій. Інакше планувальник агрегував би
 * позиції всієї таблиці й лише потім відкидав зайве.
 */
export async function lastOrders(counterpartyId: string, limit = 5): Promise<LastOrder[]> {
  const rows = await prisma.$queryRaw<OrderRow[]>`
    WITH docs AS (
      SELECT s.id, s.number, s."docType"::text AS "docType", s."createdAt", s."totalAmount"
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
        AND s."counterpartyId" = ${counterpartyId}
      ORDER BY s."createdAt" DESC
      LIMIT ${limit}
    )
    SELECT
      d.id,
      d.number,
      d."docType",
      d."createdAt",
      d."totalAmount"::float AS "totalAmount",
      COALESCE((
        SELECT json_agg(json_build_object(
          'productId',    p.id,
          'name',         p.name,
          'sku',          p.sku,
          'brand',        b.name,
          'brandColor',   b.color,
          'quantity',     i.quantity::int,
          'sellingPrice', i."sellingPrice"::float,
          'amount',       (i.quantity * i."sellingPrice")::float
        ) ORDER BY (i.quantity * i."sellingPrice") DESC)
        FROM "SalesDocumentItem" i
        JOIN "Product" p ON p.id = i."productId"
        LEFT JOIN "Brand" b ON b.id = p."brandId"
        WHERE i."salesDocumentId" = d.id
      ), '[]'::json) AS items
    FROM docs d
    ORDER BY d."createdAt" DESC
  `;

  const now = Date.now();
  return rows.map((row) => {
    const items = row.items ?? [];
    return {
      id: row.id,
      number: row.number,
      docType: row.docType,
      createdAt: row.createdAt.toISOString(),
      daysAgo: Math.max(0, Math.floor((now - row.createdAt.getTime()) / DAY_MS)),
      totalAmount: row.totalAmount,
      itemsAmount: items.reduce((sum, i) => sum + i.amount, 0),
      items,
    };
  });
}

type ReplenishRow = {
  productId: string;
  name: string;
  sku: string | null;
  brand: string | null;
  brandColor: string | null;
  price: number;
  times: number;
  amount: number;
  daysSince: number;
  cycleDays: number | null;
};

/**
 * Товари, які клієнт бере регулярно, але цього разу затримався.
 *
 * Повернення виключені (docType <> 'RETURN'): повернутий товар — це не факт
 * попиту, і пропонувати його «повторити» було б знущанням.
 *
 * Пороги лишаються в TypeScript, а не в SQL, — як classify() у clients.ts:
 * так вони в одному місці й читаються без запуску запиту.
 */
async function replenishment(counterpartyId: string): Promise<Recommendation[]> {
  const rows = await prisma.$queryRaw<ReplenishRow[]>`
    WITH lines AS (
      SELECT
        i."productId",
        s."createdAt",
        (i.quantity * i."sellingPrice") AS amount
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      WHERE ${SOURCE_FILTER}
        AND s."counterpartyId" = ${counterpartyId}
        AND s."docType" <> 'RETURN'
    ),
    per_product AS (
      SELECT
        l."productId",
        COUNT(DISTINCT l."createdAt")::int AS times,
        MIN(l."createdAt") AS "firstAt",
        MAX(l."createdAt") AS "lastAt",
        SUM(l.amount)::float AS amount
      FROM lines l
      GROUP BY 1
      -- Разова покупка не має ритму, тож і «пора повторити» для неї не існує
      HAVING COUNT(DISTINCT l."createdAt") >= 2
    )
    SELECT
      pp."productId",
      p.name,
      p.sku,
      b.name  AS brand,
      b.color AS "brandColor",
      p.price::float AS price,
      pp.times,
      pp.amount,
      (EXTRACT(EPOCH FROM (NOW() - pp."lastAt")) / 86400)::float AS "daysSince",
      NULLIF(
        (EXTRACT(EPOCH FROM (pp."lastAt" - pp."firstAt")) / 86400) / NULLIF(pp.times - 1, 0),
        0
      )::float AS "cycleDays"
    FROM per_product pp
    JOIN "Product" p ON p.id = pp."productId"
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    -- Пропонувати те, чого немає на складі або знято з продажу, — гірше,
    -- ніж не пропонувати нічого: торговий пообіцяє, а привезти не зможе.
    -- price > 0 з тієї ж причини: у 486 активних позицій ціни просто немає.
    WHERE p."isActive" AND p.stock > 0 AND p.price > 0
  `;

  const out: Recommendation[] = [];
  for (const r of rows) {
    if (!r.cycleDays) continue;
    const overdue = r.daysSince / r.cycleDays;
    if (overdue < OVERDUE_MIN) continue;

    const since = Math.round(r.daysSince);
    const cycle = Math.round(r.cycleDays);
    const dropped = overdue > OVERDUE_DROPPED;

    out.push({
      key: `product:${r.productId}`,
      reason: dropped ? "DROPPED" : "REPLENISH",
      name: r.name,
      sku: r.sku,
      brand: r.brand,
      brandColor: r.brandColor,
      price: r.price,
      why: dropped
        ? `брав ${times(r.times)}, ~раз на ${days(cycle)}, але не бере вже ${days(since)}`
        : `брав ${times(r.times)}, ~раз на ${days(cycle)}, останній раз ${days(since)} тому`,
      // Логарифм по грошах, щоб один дорогий товар не витіснив усе інше;
      // прострочення й регулярність обмежені стелею з тієї ж причини.
      score:
        Math.log1p(Math.max(0, r.amount)) *
        Math.min(overdue, 2.5) *
        Math.min(r.times / 3, 2) *
        (dropped ? 0.8 : 1),
    });
  }
  return out;
}

type PeerRow = {
  brandId: string;
  brand: string;
  brandColor: string | null;
  peerClients: number;
  affinity: number;
  topProduct: { id: string; name: string; sku: string | null; price: number } | null;
};

/**
 * Бренди, яких клієнт не бере, а схожі на нього клієнти — беруть.
 *
 * Це і є відповідь на «якщо він колись замовляв будматеріали — рекомендувати
 * цю групу»: група тут — бренд, а всередині показуємо конкретний товар, який
 * реально є на складі. Сама назва бренду торговому нічого не дає, з нею не
 * прийдеш до клієнта.
 */
async function similarClients(counterpartyId: string): Promise<Recommendation[]> {
  const rows = await prisma.$queryRaw<PeerRow[]>`
    WITH mine AS (
      SELECT DISTINCT p."brandId"
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      WHERE ${SOURCE_FILTER}
        AND s."counterpartyId" = ${counterpartyId}
        AND s."docType" <> 'RETURN'
        AND p."brandId" IS NOT NULL
    ),
    peers AS (
      SELECT s."counterpartyId" AS cid, COUNT(DISTINCT p."brandId")::int AS shared
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      WHERE ${SOURCE_FILTER}
        AND s."docType" <> 'RETURN'
        AND s."counterpartyId" IS NOT NULL
        AND s."counterpartyId" <> ${counterpartyId}
        AND p."brandId" IN (SELECT "brandId" FROM mine)
      GROUP BY 1
      HAVING COUNT(DISTINCT p."brandId") >= ${PEER_OVERLAP}
    ),
    candidate AS (
      SELECT
        p."brandId",
        COUNT(DISTINCT s."counterpartyId")::int AS "peerClients",
        SUM(pe.shared)::float AS affinity
      FROM "SalesDocumentItem" i
      JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
      JOIN "Product" p ON p.id = i."productId"
      JOIN peers pe ON pe.cid = s."counterpartyId"
      WHERE ${SOURCE_FILTER}
        AND s."docType" <> 'RETURN'
        AND p."brandId" IS NOT NULL
        AND p."brandId" NOT IN (SELECT "brandId" FROM mine)
      GROUP BY 1
      HAVING COUNT(DISTINCT s."counterpartyId") >= ${PEER_SUPPORT}
    )
    SELECT
      c."brandId",
      b.name  AS brand,
      b.color AS "brandColor",
      c."peerClients",
      c.affinity,
      (
        SELECT json_build_object('id', p2.id, 'name', p2.name, 'sku', p2.sku, 'price', p2.price::float)
        FROM "Product" p2
        -- price > 0 обов'язково: 486 із 6833 активних товарів у наявності
        -- мають нульову ціну (не всі позиції 1С мають тип цін «МАГАЗИНИ»).
        -- Без цієї умови саме вони й вигравали слот бренду, бо priority у них
        -- теж 0 — торговому показувало товар, який він не може продати.
        WHERE p2."brandId" = c."brandId" AND p2."isActive" AND p2.stock > 0 AND p2.price > 0
        ORDER BY p2.priority DESC, p2.stock DESC
        LIMIT 1
      ) AS "topProduct"
    FROM candidate c
    JOIN "Brand" b ON b.id = c."brandId"
    WHERE b."isActive"
    ORDER BY c.affinity DESC
    LIMIT 20
  `;

  // Дедуплікація за назвою, а не за brandId: у довіднику є два різні рядки
  // Brand із назвою «Grösser» (відрізняються нормалізацією «ö» — саме тому
  // @unique на name їх пропустив). Без цього клієнт побачив би дві однакові
  // картки й вирішив би, що система зламана.
  const byName = new Map<string, PeerRow>();
  for (const r of rows) {
    if (!r.topProduct) continue;
    const key = r.brand.trim().normalize("NFC").toLowerCase();
    const seen = byName.get(key);
    if (seen) {
      seen.peerClients += r.peerClients;
      if (r.affinity > seen.affinity) seen.affinity = r.affinity;
      continue;
    }
    byName.set(key, { ...r });
  }

  return [...byName.values()].map((r) => ({
    key: `brand:${r.brandId}`,
    reason: "SIMILAR_CLIENTS" as const,
    name: r.topProduct!.name,
    sku: r.topProduct!.sku,
    brand: r.brand,
    brandColor: r.brandColor,
    price: r.topProduct!.price,
    why: `${r.peerClients} ${plural(r.peerClients, "схожий клієнт бере", "схожі клієнти беруть", "схожих клієнтів беруть")} ${r.brand}, цей — ще ні`,
    score: r.affinity,
  }));
}

const REASON_ORDER: Record<RecoReason, number> = {
  REPLENISH: 0,
  DROPPED: 1,
  SIMILAR_CLIENTS: 2,
};

/**
 * Підсумковий список порад.
 *
 * Одне місце гарантовано віддаємо пораді «беруть схожі клієнти»: у клієнта з
 * багатою історією поповнення інакше забирає всі шість рядків, і торговий
 * ніколи не побачить, чим розширити асортимент.
 */
export async function recommendations(counterpartyId: string): Promise<Recommendation[]> {
  const [own, peers] = await Promise.all([
    replenishment(counterpartyId),
    similarClients(counterpartyId),
  ]);

  const byScore = (a: Recommendation, b: Recommendation) => b.score - a.score;
  own.sort(byScore);
  peers.sort(byScore);

  const picked = own.slice(0, peers.length ? MAX_RECOMMENDATIONS - 1 : MAX_RECOMMENDATIONS);
  picked.push(...peers.slice(0, MAX_RECOMMENDATIONS - picked.length));

  return picked.sort(
    (a, b) => REASON_ORDER[a.reason] - REASON_ORDER[b.reason] || b.score - a.score
  );
}
