/**
 * Портфель клієнтів торгового: кого розпрацював, кого втрачає, хто відвалився.
 *
 * Дашборд показує топ клієнтів за оборотом — але найважливіші рядки там не
 * видно взагалі: клієнт, який брав щотижня і замовк місяць тому, у топі
 * лишається (оборот за період у нього ще великий), а те, що він уже пішов,
 * помітно тільки за датою останнього документа.
 *
 * Стан клієнта рахується детерміновано, порогами нижче, а не моделлю:
 * керівник має бачити ті самі числа, що й програма, і мати змогу
 * заперечити конкретному порогу.
 *
 * ВАЖЛИВО про дані: візитів у нас немає (SalesTrip майже порожній), тож
 * «частота роботи з клієнтом» тут — це частота ДОКУМЕНТІВ. Це чесний
 * проксі, але в інтерфейсі його треба підписувати саме так, а не «візити».
 */

import { Prisma } from "@prisma/client";
import { agingByCounterparty } from "./money-facts";
import { prisma } from "@/lib/prisma";
import { SOURCE_FILTER } from "@/lib/analytics/facts";
import type { Period } from "@/lib/analytics/period";

/**
 * Пороги станів у днях без документа.
 *
 * Прив'язані до реального циклу закупівель будматеріалів: типовий активний
 * клієнт бере раз на 2-4 тижні. Тому 60 днів — це вже два-три пропущені
 * цикли (сплячий), а 90 — сезон, який клієнт провів в іншого постачальника.
 *
 * SLIPPING рахується не від фіксованого порога, а від власного ритму
 * клієнта: той, хто брав щотижня, а не брав 20 днів, — тривожніший за того,
 * хто завжди бере раз на місяць.
 */
export const DORMANT_DAYS = 60;
export const LOST_DAYS = 90;
export const SLIPPING_FACTOR = 1.5;

/**
 * Пауза, коротша за це, не вважається згасанням незалежно від ритму.
 *
 * Ритм рахується за ДНЯМИ з покупками, а не за документами: клієнт часто
 * бере кілька накладних за одну поставку, і рахунок по документах приписував
 * такому «ритм» у 2-3 дні. Разом із цим у найчастіших клієнтів поріг
 * SLIPPING виходив коротшим за вихідні — тому нижня межа: тиждень без
 * документа лежить у нормальному циклі закупівлі (раз на 2-4 тижні, див.
 * вище) і не тривожний ні для кого.
 */
export const MIN_SLIPPING_DAYS = 7;

/**
 * Мінімум документів, щоб вважати клієнта втраченим.
 *
 * Один документ за всю історію — це разова покупка, а не втрачений клієнт.
 * Без цієї умови в LOST потрапляли б сотні випадкових контрагентів і
 * ховали б справжні втрати.
 */
const MIN_DOCS_FOR_LOST = 2;

export type ClientState = "NEW" | "ACTIVE" | "SLIPPING" | "DORMANT" | "LOST";

export type PortfolioClient = {
  counterpartyId: string;
  name: string;
  /** Перший документ у нашій історії — не обов'язково перший в житті клієнта */
  firstDocAt: string;
  lastDocAt: string;
  daysSinceLast: number;
  /** Документи й оборот за обраний період */
  docs: number;
  amount: number;
  /** Середній інтервал між днями з покупками за всю історію, днів */
  avgIntervalDays: number;
  skuCount: number;
  brandCount: number;
  receivable: number;
  overdue: number;
  state: ClientState;
};

export type RepClientPortfolio = {
  repId: string;
  clients: PortfolioClient[];
  counts: Record<ClientState, number>;
  /** Оборот від клієнтів, які вперше з'явилися в межах періоду */
  newRevenue: number;
  /**
   * Скільки давали за період ті, хто вже у стані LOST. Це не «втрачені
   * гроші» буквально, а масштаб проблеми: скільки обороту стоїть за
   * клієнтами, які перестали брати.
   */
  lostRevenue: number;
  /** Скільки клієнтів взагалі є в портфелі (за всю історію, не за період) */
  totalClients: number;
};

type PortfolioRow = {
  counterpartyId: string;
  name: string;
  /**
   * Обидва запити нижче відсікають рядки з NULL-датами (лише повернення),
   * тож тут Date, а не Date | null. Якщо колись з'явиться третій запит —
   * фільтр треба повторити, інакше classify() впаде на .getTime().
   */
  firstDocAt: Date;
  lastDocAt: Date;
  historyDocs: number;
  /** Різних днів із покупками за історію — ритм рахується по них, не по документах */
  historyDays: number;
  docs: number;
  amount: number;
  skuCount: number;
  brandCount: number;
  receivable: number;
  debtOverdue: number;
};

/**
 * Сирі дані портфеля одним запитом.
 *
 * Період тут потрібен двічі й по-різному: first/last документ рахуються за
 * ВСЮ історію (інакше «новий клієнт» означало б лише «перший документ у
 * вибраному вікні», і кожен звужений період видавав би нових клієнтів
 * пачками), а оборот і документи — за обраний період.
 *
 * `h."firstDocAt" IS NOT NULL` відсікає контрагентів, у яких з цим торговим
 * є лише повернення. FILTER (WHERE docType <> 'RETURN') на MIN/MAX дає їм
 * NULL-дати при непорожньому рядку — і classify() падав на .getTime().
 * У портфелі їм і не місце: клієнта, який нічого не купував, не можна
 * назвати ні активним, ні втраченим.
 */
async function portfolioRows(repId: string, period: Period): Promise<PortfolioRow[]> {
  return prisma.$queryRaw<PortfolioRow[]>`
    WITH docs AS (
      SELECT
        s.id,
        s."counterpartyId",
        s."createdAt",
        s."totalAmount",
        s."docType"
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
        AND s."salesRepId" = ${repId}
        AND s."counterpartyId" IS NOT NULL
    ),
    period_docs AS (
      SELECT
        d."counterpartyId",
        COUNT(*) FILTER (WHERE d."docType" <> 'RETURN')::int AS docs,
        SUM(d."totalAmount")::float AS amount
      FROM docs d
      WHERE d."createdAt" >= ${period.from} AND d."createdAt" <= ${period.to}
      GROUP BY 1
    ),
    history AS (
      SELECT
        d."counterpartyId",
        MIN(d."createdAt") FILTER (WHERE d."docType" <> 'RETURN') AS "firstDocAt",
        MAX(d."createdAt") FILTER (WHERE d."docType" <> 'RETURN') AS "lastDocAt",
        COUNT(*) FILTER (WHERE d."docType" <> 'RETURN')::int AS "historyDocs",
        COUNT(DISTINCT (d."createdAt" AT TIME ZONE 'Europe/Kyiv')::date)
          FILTER (WHERE d."docType" <> 'RETURN')::int AS "historyDays"
      FROM docs d
      GROUP BY 1
    ),
    assortment AS (
      SELECT
        d."counterpartyId",
        COUNT(DISTINCT i."productId") FILTER (WHERE d."docType" <> 'RETURN')::int AS "skuCount",
        COUNT(DISTINCT p."brandId") FILTER (WHERE d."docType" <> 'RETURN')::int AS "brandCount"
      FROM docs d
      JOIN "SalesDocumentItem" i ON i."salesDocumentId" = d.id
      JOIN "Product" p ON p.id = i."productId"
      WHERE d."createdAt" >= ${period.from} AND d."createdAt" <= ${period.to}
      GROUP BY 1
    )
    SELECT
      h."counterpartyId" AS "counterpartyId",
      c.name             AS name,
      h."firstDocAt"     AS "firstDocAt",
      h."lastDocAt"      AS "lastDocAt",
      h."historyDocs"    AS "historyDocs",
      h."historyDays"    AS "historyDays",
      COALESCE(pd.docs, 0)::int      AS docs,
      COALESCE(pd.amount, 0)::float  AS amount,
      COALESCE(a."skuCount", 0)::int   AS "skuCount",
      COALESCE(a."brandCount", 0)::int AS "brandCount",
      COALESCE(c."receivableBalance", 0)::float AS receivable,
      -- Прострочка домішується вже в JS: 1С не надсилає розбивку за
      -- строками (поля debtOverdue* порожні у ВСІХ контрагентів), тож
      -- рахуємо її з дат наших відвантажень — так само, як аналітика.
      0::float AS "debtOverdue"
    FROM history h
    JOIN "Counterparty" c ON c.id = h."counterpartyId"
    LEFT JOIN period_docs pd ON pd."counterpartyId" = h."counterpartyId"
    LEFT JOIN assortment a   ON a."counterpartyId"  = h."counterpartyId"
    WHERE h."firstDocAt" IS NOT NULL
    ORDER BY COALESCE(pd.amount, 0) DESC
  `;
}

const DAY_MS = 86_400_000;

/**
 * Стан клієнта на кінець періоду.
 *
 * Відлік ведеться від кінця обраного періоду, а не від «сьогодні»: коли
 * керівник дивиться на липень, клієнт має бути позначений так, як
 * виглядав у липні, інакше при погляді назад усі поспіль виявляться
 * втраченими.
 */
export type ClientRhythmRow = {
  firstDocAt: Date;
  lastDocAt: Date;
  /** Документів за всю історію — без них LOST не відрізнити від разової покупки */
  historyDocs: number;
  /** Різних ДНІВ із покупками за історію — по них рахується ритм */
  historyDays: number;
};

export function classifyClient(row: ClientRhythmRow, period: Period): ClientState {
  const asOf = period.to.getTime();
  const daysSinceLast = Math.floor((asOf - row.lastDocAt.getTime()) / DAY_MS);

  // Новий — перший документ потрапив у вікно періоду. Перевіряється
  // першим: клієнт, який щойно з'явився, за визначенням ще не може бути
  // «сплячим», навіть якщо взяв один раз на початку періоду.
  if (row.firstDocAt.getTime() >= period.from.getTime()) return "NEW";

  if (daysSinceLast >= LOST_DAYS && row.historyDocs >= MIN_DOCS_FOR_LOST) return "LOST";
  if (daysSinceLast >= DORMANT_DAYS) return "DORMANT";

  // Коротка пауза — не сигнал, навіть якщо клієнт зазвичай бере частіше.
  if (daysSinceLast < MIN_SLIPPING_DAYS) return "ACTIVE";

  // Власний ритм клієнта: скільки днів історії припадає на один ДЕНЬ із
  // покупками. По документах рахувати не можна — кілька накладних за одну
  // поставку робили б ритм штучно швидким.
  const spanDays = Math.max(1, (row.lastDocAt.getTime() - row.firstDocAt.getTime()) / DAY_MS);
  const avgInterval = row.historyDays > 1 ? spanDays / (row.historyDays - 1) : spanDays;

  if (daysSinceLast > avgInterval * SLIPPING_FACTOR) return "SLIPPING";
  return "ACTIVE";
}

export function avgIntervalDays(row: Pick<ClientRhythmRow, "firstDocAt" | "lastDocAt" | "historyDays">): number {
  if (row.historyDays <= 1) return 0;
  const spanDays = (row.lastDocAt.getTime() - row.firstDocAt.getTime()) / DAY_MS;
  return spanDays / (row.historyDays - 1);
}

/** Портфель клієнтів торгового зі станами й підсумками. */
export async function clientPortfolio(repId: string, period: Period): Promise<RepClientPortfolio> {
  const rows = await portfolioRows(repId, period);
  const asOf = period.to.getTime();

  const counts: Record<ClientState, number> = {
    NEW: 0,
    ACTIVE: 0,
    SLIPPING: 0,
    DORMANT: 0,
    LOST: 0,
  };
  let newRevenue = 0;
  let lostRevenue = 0;

  // Прострочка — окремим запитом по клієнтах цього торгового. Порахувати її
  // в тому ж SQL не вийде: вік боргу відновлюється розкладанням сальдо по
  // датах відвантажень, а не читанням поля.
  const aging = await agingByCounterparty(rows.map((r) => r.counterpartyId));

  const clients: PortfolioClient[] = rows.map((row) => {
    const state = classifyClient(row, period);
    counts[state] += 1;
    if (state === "NEW") newRevenue += row.amount;
    if (state === "LOST") lostRevenue += row.amount;

    return {
      counterpartyId: row.counterpartyId,
      name: row.name,
      firstDocAt: row.firstDocAt.toISOString(),
      lastDocAt: row.lastDocAt.toISOString(),
      daysSinceLast: Math.max(0, Math.floor((asOf - row.lastDocAt.getTime()) / DAY_MS)),
      docs: row.docs,
      amount: row.amount,
      avgIntervalDays: avgIntervalDays(row),
      skuCount: row.skuCount,
      brandCount: row.brandCount,
      receivable: row.receivable,
      overdue: aging.get(row.counterpartyId)?.overdue ?? 0,
      state,
    };
  });

  return {
    repId,
    clients,
    counts,
    newRevenue,
    lostRevenue,
    totalClients: rows.length,
  };
}

export type MapClient = PortfolioClient & {
  lat: number | null;
  lng: number | null;
  address: string | null;
  geoSource: string | null;
  /** Торгові, за якими закріплений клієнт (може бути кілька або жодного) */
  reps: Array<{ id: string; name: string }>;
};

export type ClientMapPortfolio = {
  clients: MapClient[];
  counts: Record<ClientState, number>;
};

type MapRow = PortfolioRow & {
  lat: number | null;
  lng: number | null;
  address: string | null;
  geoSource: string | null;
  reps: Array<{ id: string; name: string }> | null;
};

/**
 * Портфель клієнтів по всій компанії — для карти.
 *
 * Той самий SQL, що в portfolioRows, але без прив'язки до торгового:
 * на карті мають бути й клієнти, документи яких не змаплені на людину
 * (у 1С торговий проставлений не всюди). Інакше з карти зникали б саме
 * ті точки, які найбільше треба комусь віддати.
 *
 * Класифікація навмисно та сама функція classifyClient(), а не копія порогів:
 * колір на карті мусить збігатися зі станом у картці торгового.
 */
export async function clientPortfolioAll(period: Period): Promise<ClientMapPortfolio> {
  const rows = await prisma.$queryRaw<MapRow[]>`
    WITH docs AS (
      SELECT
        s.id,
        s."counterpartyId",
        s."createdAt",
        s."totalAmount",
        s."docType"
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
        AND s."counterpartyId" IS NOT NULL
    ),
    period_docs AS (
      SELECT
        d."counterpartyId",
        COUNT(*) FILTER (WHERE d."docType" <> 'RETURN')::int AS docs,
        SUM(d."totalAmount")::float AS amount
      FROM docs d
      WHERE d."createdAt" >= ${period.from} AND d."createdAt" <= ${period.to}
      GROUP BY 1
    ),
    history AS (
      SELECT
        d."counterpartyId",
        MIN(d."createdAt") FILTER (WHERE d."docType" <> 'RETURN') AS "firstDocAt",
        MAX(d."createdAt") FILTER (WHERE d."docType" <> 'RETURN') AS "lastDocAt",
        COUNT(*) FILTER (WHERE d."docType" <> 'RETURN')::int AS "historyDocs",
        COUNT(DISTINCT (d."createdAt" AT TIME ZONE 'Europe/Kyiv')::date)
          FILTER (WHERE d."docType" <> 'RETURN')::int AS "historyDays"
      FROM docs d
      GROUP BY 1
    )
    SELECT
      h."counterpartyId" AS "counterpartyId",
      c.name             AS name,
      h."firstDocAt"     AS "firstDocAt",
      h."lastDocAt"      AS "lastDocAt",
      h."historyDocs"    AS "historyDocs",
      h."historyDays"    AS "historyDays",
      COALESCE(pd.docs, 0)::int     AS docs,
      COALESCE(pd.amount, 0)::float AS amount,
      0::int   AS "skuCount",
      0::int   AS "brandCount",
      COALESCE(c."receivableBalance", 0)::float AS receivable,
      -- Прострочка домішується вже в JS: 1С не надсилає розбивку за
      -- строками (поля debtOverdue* порожні у ВСІХ контрагентів), тож
      -- рахуємо її з дат наших відвантажень — так само, як аналітика.
      0::float AS "debtOverdue",
      c."deliveryLat" AS lat,
      c."deliveryLng" AS lng,
      c.address       AS address,
      c."geoSource"::text AS "geoSource",
      (
        SELECT COALESCE(json_agg(json_build_object('id', u.id, 'name', u.name)), '[]'::json)
        FROM "SalesRepClient" src
        JOIN "User" u ON u.id = src."salesRepId"
        WHERE src."counterpartyId" = h."counterpartyId"
      ) AS reps
    FROM history h
    JOIN "Counterparty" c ON c.id = h."counterpartyId"
    LEFT JOIN period_docs pd ON pd."counterpartyId" = h."counterpartyId"
    WHERE h."firstDocAt" IS NOT NULL
    ORDER BY COALESCE(pd.amount, 0) DESC
  `;

  const asOf = period.to.getTime();
  const counts: Record<ClientState, number> = {
    NEW: 0,
    ACTIVE: 0,
    SLIPPING: 0,
    DORMANT: 0,
    LOST: 0,
  };

  // Один запит на всіх боржників замість LATERAL на кожного з ~3000 рядків.
  const aging = await agingByCounterparty(null);

  const clients = rows.map((row) => {
    const state = classifyClient(row, period);
    counts[state] += 1;

    return {
      counterpartyId: row.counterpartyId,
      name: row.name,
      firstDocAt: row.firstDocAt.toISOString(),
      lastDocAt: row.lastDocAt.toISOString(),
      daysSinceLast: Math.max(0, Math.floor((asOf - row.lastDocAt.getTime()) / DAY_MS)),
      docs: row.docs,
      amount: row.amount,
      avgIntervalDays: avgIntervalDays(row),
      skuCount: row.skuCount,
      brandCount: row.brandCount,
      receivable: row.receivable,
      overdue: aging.get(row.counterpartyId)?.overdue ?? 0,
      state,
      lat: row.lat,
      lng: row.lng,
      address: row.address,
      geoSource: row.geoSource,
      reps: row.reps ?? [],
    };
  });

  return { clients, counts };
}

export type PortfolioCounts = {
  repId: string;
  newClients: number;
  lostClients: number;
  slippingClients: number;
  activeClients: number;
  totalClients: number;
};

/**
 * Лічильники станів по всій команді — для бенчмарку.
 *
 * Рахуються тим самим SQL і тими самими порогами, що й портфель одного
 * торгового, щоб таблиця команди не розійшлася з карткою людини.
 * Класифікація лишається в JS: дублювати пороги ще й у SQL означало б
 * два місця, які колись розійдуться.
 */
export async function portfolioCountsByRep(period: Period): Promise<Map<string, PortfolioCounts>> {
  const rows = await prisma.$queryRaw<Array<PortfolioRow & { repId: string }>>`
    WITH docs AS (
      SELECT
        s.id,
        s."salesRepId",
        s."counterpartyId",
        s."createdAt",
        s."totalAmount",
        s."docType"
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
        AND s."salesRepId" IS NOT NULL
        AND s."counterpartyId" IS NOT NULL
    ),
    period_docs AS (
      SELECT d."salesRepId", d."counterpartyId",
             COUNT(*) FILTER (WHERE d."docType" <> 'RETURN')::int AS docs,
             SUM(d."totalAmount")::float AS amount
      FROM docs d
      WHERE d."createdAt" >= ${period.from} AND d."createdAt" <= ${period.to}
      GROUP BY 1, 2
    ),
    history AS (
      SELECT d."salesRepId", d."counterpartyId",
             MIN(d."createdAt") FILTER (WHERE d."docType" <> 'RETURN') AS "firstDocAt",
             MAX(d."createdAt") FILTER (WHERE d."docType" <> 'RETURN') AS "lastDocAt",
             COUNT(*) FILTER (WHERE d."docType" <> 'RETURN')::int AS "historyDocs",
             COUNT(DISTINCT (d."createdAt" AT TIME ZONE 'Europe/Kyiv')::date)
               FILTER (WHERE d."docType" <> 'RETURN')::int AS "historyDays"
      FROM docs d
      GROUP BY 1, 2
    )
    SELECT
      h."salesRepId"     AS "repId",
      h."counterpartyId" AS "counterpartyId",
      ''                 AS name,
      h."firstDocAt"     AS "firstDocAt",
      h."lastDocAt"      AS "lastDocAt",
      h."historyDocs"    AS "historyDocs",
      h."historyDays"    AS "historyDays",
      COALESCE(pd.docs, 0)::int     AS docs,
      COALESCE(pd.amount, 0)::float AS amount,
      0::int   AS "skuCount",
      0::int   AS "brandCount",
      0::float AS receivable,
      0::float AS "debtOverdue"
    FROM history h
    LEFT JOIN period_docs pd
      ON pd."salesRepId" = h."salesRepId" AND pd."counterpartyId" = h."counterpartyId"
    WHERE h."firstDocAt" IS NOT NULL
  `;

  const map = new Map<string, PortfolioCounts>();
  for (const row of rows) {
    const acc =
      map.get(row.repId) ??
      { repId: row.repId, newClients: 0, lostClients: 0, slippingClients: 0, activeClients: 0, totalClients: 0 };

    const state = classifyClient(row, period);
    if (state === "NEW") acc.newClients += 1;
    else if (state === "LOST") acc.lostClients += 1;
    else if (state === "SLIPPING") acc.slippingClients += 1;
    else if (state === "ACTIVE") acc.activeClients += 1;
    acc.totalClients += 1;

    map.set(row.repId, acc);
  }
  return map;
}
