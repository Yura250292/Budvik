/**
 * Факти для аналітики торгових: продажі з 1С, поїздки з бота, паливо.
 *
 * Живуть окремо від роутів, бо ті самі числа потрібні в трьох місцях —
 * виконання планів, профіль торгового і вкладка палива. Дублювати SQL
 * означало б, що «оборот» у КПІ і в профілі колись розійдеться.
 *
 * Фільтр джерела всюди однаковий — див. SOURCE_FILTER нижче.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { kyivDayStart } from "@/lib/date/kyiv";
import { ANALYTICS_SINCE_DAY } from "@/lib/analytics/since";

/** Дефолти авто, якщо для торгового ще не заведено SalesVehicle. */
export const VEHICLE_DEFAULTS = { fuelConsumption: 10, fuelPricePerL: 56 };

export type RepRevenue = {
  repId: string;
  /** Оборот НЕТТО: реалізації мінус повернення. */
  amount: number;
  docs: number;
  clients: number;
  profit: number;
  /** Сума повернень за період, додатна — щоб показати її окремою колонкою. */
  returns: number;
};
export type RepBrandRevenue = { repId: string; brandId: string | null; brandName: string | null; amount: number; qty: number };

/**
 * Що вважається продажем торгового. Експортується, щоб той самий фільтр стояв
 * у сирих запитах роутів аналітики: колись дубльовані копії неминуче
 * розійшлися б, і «оборот» у КПІ перестав би збігатися з оборотом в огляді.
 *
 * docType — головне: рахуємо РЕАЛІЗАЦІЮ (фактично відвантажене), а не
 * замовлення. Замовлення — це намір, який може бути скасований, урізаний
 * складом або так і не поїхати; премію торговому платять за відвантажене.
 * Обидва типи лежать в одній таблиці, тож без цієї умови кожна партія
 * рахувалася б двічі.
 *
 * RETURN входить сюди разом із реалізацією і робить оборот НЕТТО: суми й
 * кількості повернень зберігаються від'ємними, тож SUM() віднімає їх сам.
 * Доти повернень не було в обміні взагалі — 2099 документів на 4,6 млн грн
 * за три роки, на які оборот і КПІ були завищені.
 *
 * externalId IS NOT NULL — лише те, що прийшло з 1С: документи, створені
 * вручну на сайті, у звіт торгових не потрапляють.
 * CONFIRMED — лише проведені: непроведений документ ще не відбувся.
 */
export const SOURCE_FILTER = Prisma.sql`s."externalId" IS NOT NULL AND s.status = 'CONFIRMED' AND s."docType" IN ('REALIZATION', 'RETURN')`;

/**
 * Те саме, але тільки продажі — для ЛІЧИЛЬНИКІВ, а не для сум.
 *
 * Гроші повернення віднімає, а от кількість документів, клієнтів і
 * пропрацьованих SKU — ні: повернення не «ще один продаж» і не «ще один
 * охоплений клієнт». Без цієї умови середній чек попливе, бо знаменник
 * зросте, а чисельник зменшиться.
 */
export const SALES_ONLY = Prisma.sql`s."docType" <> 'RETURN'`;

/**
 * Нижня межа аналітики — див. ANALYTICS_SINCE_DAY у lib/analytics/since.ts.
 *
 * parsePeriod уже обрізає період на вході, але межа продубльована тут
 * навмисно: facts викликають і в обхід parsePeriod (мотивація, інсайти,
 * бенчмарк рахують місяці самі), і без цієї страховки такий виклик
 * повернув би від'ємний оборот за 2023–2025.
 */
export const ANALYTICS_SINCE = kyivDayStart(ANALYTICS_SINCE_DAY);

/** Підтягує початок періоду до межі історії. */
export function clampFrom(from: Date): Date {
  return from < ANALYTICS_SINCE ? ANALYTICS_SINCE : from;
}

/** Оборот по кожному торговому за період. */
export async function revenueByRep(from: Date, to: Date, repId?: string | null): Promise<RepRevenue[]> {
  const repCondition = repId ? Prisma.sql`AND s."salesRepId" = ${repId}` : Prisma.empty;
  from = clampFrom(from);

  const rows = await prisma.$queryRaw<RepRevenue[]>`
    SELECT
      s."salesRepId" AS "repId",
      SUM(s."totalAmount")::float AS amount,
      COUNT(*) FILTER (WHERE ${SALES_ONLY})::int AS docs,
      COUNT(DISTINCT s."counterpartyId") FILTER (WHERE ${SALES_ONLY})::int AS clients,
      COALESCE(SUM(s."profitAmount"), 0)::float AS profit,
      COALESCE(-SUM(s."totalAmount") FILTER (WHERE s."docType" = 'RETURN'), 0)::float AS returns
    FROM "SalesDocument" s
    WHERE ${SOURCE_FILTER}
      AND s."salesRepId" IS NOT NULL
      AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
      ${repCondition}
    GROUP BY s."salesRepId"
  `;
  return rows;
}

/** Один документ повернення для списку в інтерфейсі. */
export type ReturnDoc = {
  id: string;
  number: string;
  date: Date;
  clientId: string | null;
  clientName: string | null;
  repId: string | null;
  repName: string | null;
  /** Додатна сума повернення (у базі лежить від'ємна). */
  amount: number;
  items: number;
};

/** Повернення клієнта за період — додатні суми, найбільші першими. */
export type ClientReturns = {
  clientId: string | null;
  clientName: string | null;
  amount: number;
  docs: number;
};

/**
 * Фільтр самих повернень. Дзеркало SALES_ONLY: там усе, крім повернень,
 * тут — лише вони. Статус і джерело беремо ті самі, що й для обороту,
 * інакше сума повернень у списку не зійшлася б із мінусом в обороті.
 */
export const RETURNS_ONLY = Prisma.sql`s."externalId" IS NOT NULL AND s.status = 'CONFIRMED' AND s."docType" = 'RETURN'`;

/**
 * Повернення в розрізі клієнтів.
 *
 * Потрібне і моделі (щоб побачити, чи повернення розмазані по базі, чи
 * сидять в одного клієнта — це різні розмови), і вкладці «Повернення».
 */
export async function returnsByClient(
  from: Date,
  to: Date,
  repId?: string | null,
  limit = 20
): Promise<ClientReturns[]> {
  const repCondition = repId ? Prisma.sql`AND s."salesRepId" = ${repId}` : Prisma.empty;
  from = clampFrom(from);

  return prisma.$queryRaw<ClientReturns[]>`
    SELECT
      s."counterpartyId" AS "clientId",
      c.name             AS "clientName",
      -SUM(s."totalAmount")::float AS amount,
      COUNT(*)::int AS docs
    FROM "SalesDocument" s
    LEFT JOIN "Counterparty" c ON c.id = s."counterpartyId"
    WHERE ${RETURNS_ONLY}
      AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
      ${repCondition}
    GROUP BY s."counterpartyId", c.name
    ORDER BY amount DESC
    LIMIT ${limit}
  `;
}

/**
 * Список документів повернення за період.
 *
 * Сума розвертається в додатну прямо тут: у базі вона від'ємна (щоб SUM
 * віднімав її сам), але людині в таблиці мінус перед кожним рядком лише
 * заважає — знак несе сама назва колонки.
 */
export async function returnDocs(
  from: Date,
  to: Date,
  repId?: string | null,
  limit = 200
): Promise<ReturnDoc[]> {
  const repCondition = repId ? Prisma.sql`AND s."salesRepId" = ${repId}` : Prisma.empty;
  from = clampFrom(from);

  return prisma.$queryRaw<ReturnDoc[]>`
    SELECT
      s.id, s.number, s."createdAt" AS date,
      s."counterpartyId" AS "clientId",
      c.name AS "clientName",
      s."salesRepId" AS "repId",
      u.name AS "repName",
      -s."totalAmount"::float AS amount,
      (SELECT COUNT(*)::int FROM "SalesDocumentItem" i WHERE i."salesDocumentId" = s.id) AS items
    FROM "SalesDocument" s
    LEFT JOIN "Counterparty" c ON c.id = s."counterpartyId"
    LEFT JOIN "User" u ON u.id = s."salesRepId"
    WHERE ${RETURNS_ONLY}
      AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
      ${repCondition}
    ORDER BY s."createdAt" DESC
    LIMIT ${limit}
  `;
}

/** Що саме повертають: топ товарів за сумою повернень. */
export type ReturnedProduct = {
  productId: string;
  name: string;
  brandName: string | null;
  qty: number;
  amount: number;
  docs: number;
};

export async function returnedProducts(
  from: Date,
  to: Date,
  repId?: string | null,
  limit = 20
): Promise<ReturnedProduct[]> {
  const repCondition = repId ? Prisma.sql`AND s."salesRepId" = ${repId}` : Prisma.empty;
  from = clampFrom(from);

  return prisma.$queryRaw<ReturnedProduct[]>`
    SELECT
      i."productId" AS "productId",
      p.name        AS name,
      b.name        AS "brandName",
      -SUM(i.quantity)::float AS qty,
      -SUM(i.quantity * i."sellingPrice")::float AS amount,
      COUNT(DISTINCT s.id)::int AS docs
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    JOIN "Product" p ON p.id = i."productId"
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    WHERE ${RETURNS_ONLY}
      AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
      ${repCondition}
    GROUP BY i."productId", p.name, b.name
    ORDER BY amount DESC
    LIMIT ${limit}
  `;
}

/**
 * Оборот у розрізі торговий × бренд.
 *
 * Рахується з ПОЗИЦІЙ (quantity * sellingPrice), а не з totalAmount
 * документа: один документ містить товари різних брендів, розподілити його
 * підсумок неможливо. Через це сума по брендах не збігається з оборотом
 * документів на суму знижок — це очікувано.
 */
export async function revenueByRepBrand(from: Date, to: Date, repId?: string | null): Promise<RepBrandRevenue[]> {
  const repCondition = repId ? Prisma.sql`AND s."salesRepId" = ${repId}` : Prisma.empty;
  from = clampFrom(from);

  return prisma.$queryRaw<RepBrandRevenue[]>`
    SELECT
      s."salesRepId" AS "repId",
      p."brandId"    AS "brandId",
      b.name         AS "brandName",
      SUM(i.quantity * i."sellingPrice")::float AS amount,
      SUM(i.quantity)::float AS qty
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    JOIN "Product" p ON p.id = i."productId"
    LEFT JOIN "Brand" b ON b.id = p."brandId"
    WHERE ${SOURCE_FILTER}
      AND s."salesRepId" IS NOT NULL
      AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
      ${repCondition}
    GROUP BY s."salesRepId", p."brandId", b.name
    ORDER BY amount DESC NULLS LAST
  `;
}

/**
 * Скільки різних позицій і клієнтів пропрацював торговий — усього і в
 * розрізі бренду (рядок з brandId = null несе підсумок по всіх).
 *
 * Потрібне планам (метрики SKU_COUNT і CLIENTS_COUNT): «продати не менше
 * ніж на стільки» і «продати не менше стількох різних позицій» — різні
 * задачі, і друга штовхає торгового розширювати матрицю, а не догружати
 * одного клієнта.
 *
 * Рахується по SALES_ONLY: повернення не додає ні позиції, ні клієнта.
 */
export type RepSkuCount = {
  repId: string;
  brandId: string | null;
  /**
   * true — рядок є ПІДСУМКОМ по торговому (усі бренди разом).
   *
   * Без цього прапорця підсумок неможливо відрізнити від рядка товарів,
   * у яких бренд не проставлений: в обох brandId порожній. У липні це
   * давало б 3 SKU замість 203 — рядок «без бренду» затирав би підсумок.
   */
  isTotal: boolean;
  sku: number;
  clients: number;
};

export async function skuCountByRep(from: Date, to: Date, repId?: string | null): Promise<RepSkuCount[]> {
  const repCondition = repId ? Prisma.sql`AND s."salesRepId" = ${repId}` : Prisma.empty;
  from = clampFrom(from);

  return prisma.$queryRaw<RepSkuCount[]>`
    SELECT
      s."salesRepId" AS "repId",
      p."brandId"    AS "brandId",
      GROUPING(p."brandId") = 1 AS "isTotal",
      COUNT(DISTINCT i."productId")::int      AS sku,
      COUNT(DISTINCT s."counterpartyId")::int AS clients
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    JOIN "Product" p ON p.id = i."productId"
    WHERE ${SOURCE_FILTER}
      AND ${SALES_ONLY}
      AND s."salesRepId" IS NOT NULL
      AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
      ${repCondition}
    -- GROUPING SETS дає підсумок по торговому і розбивку по брендах одним
    -- проходом: рахувати «різних SKU всього» додаванням брендових не можна,
    -- бо той самий товар не подвоюється, а от клієнт у двох брендах — так.
    GROUP BY GROUPING SETS ((s."salesRepId"), (s."salesRepId", p."brandId"))
  `;
}

export type TripFacts = {
  repId: string;
  trips: number;
  totalKm: number;
  personalKm: number;
  checkpoints: number;
  daysWorked: number;
};

/**
 * Поїздки з бота за період. Лише CLOSED: у відкритої поїздки ще немає
 * кінцевого одометра, тож distanceKm порожній і кілометраж рахувати нема з чого.
 */
export async function tripFactsByRep(from: Date, to: Date, repId?: string | null): Promise<TripFacts[]> {
  const repCondition = repId ? Prisma.sql`AND t."userId" = ${repId}` : Prisma.empty;

  return prisma.$queryRaw<TripFacts[]>`
    SELECT
      t."userId" AS "repId",
      COUNT(*)::int AS trips,
      COALESCE(SUM(t."distanceKm"), 0)::float AS "totalKm",
      COALESCE(SUM(t."personalKm"), 0)::float AS "personalKm",
      COALESCE(SUM(t."checkpointsCount"), 0)::int AS checkpoints,
      COUNT(DISTINCT date_trunc('day', t."startedAt" AT TIME ZONE 'Europe/Kyiv'))::int AS "daysWorked"
    FROM "SalesTrip" t
    WHERE t.status = 'CLOSED'
      AND t."startedAt" >= ${from} AND t."startedAt" <= ${to}
      ${repCondition}
    GROUP BY t."userId"
  `;
}

export type FuelCost = {
  /** Робочі км (без особистих — ті коштом торгового) */
  workKm: number;
  liters: number;
  cost: number;
  fuelConsumption: number;
  fuelPricePerL: number;
  costPerDay: number;
};

/**
 * Вартість пального за фактом: км / 100 × норма × ціна.
 *
 * Без буфера на затори (на відміну від route-planner) — там план поїздки,
 * тут уже проїханий одометром кілометраж, накидати на нього нічого.
 * personalKm віднімаються: особисті км торговий заправляє сам.
 */
export function fuelCost(
  totalKm: number,
  personalKm: number,
  vehicle: { fuelConsumption: number; fuelPricePerL: number } | null,
  daysWorked = 0
): FuelCost {
  const consumption = vehicle?.fuelConsumption ?? VEHICLE_DEFAULTS.fuelConsumption;
  const price = vehicle?.fuelPricePerL ?? VEHICLE_DEFAULTS.fuelPricePerL;

  const workKm = Math.max(0, totalKm - personalKm);
  const liters = (workKm * consumption) / 100;
  const cost = liters * price;

  return {
    workKm,
    liters,
    cost,
    fuelConsumption: consumption,
    fuelPricePerL: price,
    costPerDay: daysWorked > 0 ? cost / daysWorked : 0,
  };
}
