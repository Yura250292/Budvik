/**
 * Грошові факти: зібрані кошти і дебіторка в розрізі торгових.
 *
 * Окремо від facts.ts, бо там продажі й поїздки — те, що торговий
 * зробив, — а тут гроші: скільки реально прийшло в касу і скільки
 * клієнти винні. Саме на цих числах будується мотивація.
 *
 * Дві принципові речі:
 *
 * 1. Дата грошей — це Payment.paidAt, а не createdAt. Другий — коли
 *    запис потрапив до нас під час синхронізації, і за ним «зібране за
 *    жовтень» після пізнього обміну поїхало б у листопад.
 *
 * 2. Дебіторка — залишок, а не потік. Вона рахується станом на «зараз»
 *    і не залежить від обраного періоду: борг не «виникає в періоді»,
 *    він просто є. Тому виклики не приймають from/to.
 */

import { Prisma, type ReceivableBucket } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  bucketForAge,
  stageForAge,
  type AgingResult,
  type WorkingStage,
} from "@/lib/erp/receivables";

export type CollectedRow = {
  repId: string;
  brandId: string | null;
  amount: number;
  profit: number;
};

/**
 * Зібрані кошти по торгових і брендах за період.
 *
 * Джерело — PaymentAllocation: сам Payment не знає, хто продав, бо
 * Invoice.salesDocumentId часто порожній. Рознесення пише синхронізація
 * (src/lib/sync-ingest/apply-payments.ts) ланцюжком DOCUMENT → CLIENT.
 *
 * paidAt nullable, тож фільтр по COALESCE: у ручних платежів дати оплати
 * може не бути, і без неї вони випали б з будь-якого періоду.
 */
export async function collectedByRepBrand(
  from: Date,
  to: Date,
  repId?: string | null
): Promise<CollectedRow[]> {
  const repCondition = repId ? Prisma.sql`AND a."repId" = ${repId}` : Prisma.empty;

  return prisma.$queryRaw<CollectedRow[]>`
    SELECT
      a."repId"   AS "repId",
      a."brandId" AS "brandId",
      SUM(a.amount)::float         AS amount,
      SUM(a."profitAmount")::float AS profit
    FROM "PaymentAllocation" a
    JOIN "Payment" p ON p.id = a."paymentId"
    WHERE COALESCE(p."paidAt", p."createdAt") >= ${from}
      AND COALESCE(p."paidAt", p."createdAt") <= ${to}
      ${repCondition}
    GROUP BY a."repId", a."brandId"
  `;
}

/** Підсумки по торгових без розрізу брендів. */
export function collectedTotals(rows: CollectedRow[]): Map<string, { amount: number; profit: number }> {
  const map = new Map<string, { amount: number; profit: number }>();
  for (const row of rows) {
    const acc = map.get(row.repId) ?? { amount: 0, profit: 0 };
    acc.amount += row.amount;
    acc.profit += row.profit;
    map.set(row.repId, acc);
  }
  return map;
}

/** Розріз по брендах у форматі, який очікує рушій мотивації. */
export function collectedByBrand(
  rows: CollectedRow[],
  repId: string
): Map<string, { collected: number; profit: number }> {
  const map = new Map<string, { collected: number; profit: number }>();
  for (const row of rows) {
    if (row.repId !== repId || !row.brandId) continue;
    const acc = map.get(row.brandId) ?? { collected: 0, profit: 0 };
    acc.collected += row.amount;
    acc.profit += row.profit;
    map.set(row.brandId, acc);
  }
  return map;
}

export type ReceivableRow = {
  counterpartyId: string;
  clientName: string;
  clientCode: string | null;
  /** Загальний борг клієнта за даними 1С */
  debt: number;
  /** Коли 1С востаннє оновила сальдо */
  syncedAt: Date | null;
  /** Дата останнього відвантаження — довідково, «коли востаннє брали товар» */
  lastDocAt: Date | null;
  /** null — борг не вдалося віднести до жодного торгового */
  repId: string | null;
  /**
   * Розкладка боргу за віком, порахована з наших відвантажень (див.
   * `spreadDebtOverShipments`). Порожня, якщо документів під борг немає.
   */
  aged: AgedSlice[];
  /** Частина боргу, вік якої встановити не вдалося */
  unknownDebt: number;
};

/** Шматок боргу з відомим віком. */
export type AgedSlice = {
  amount: number;
  /** Днів від відвантаження */
  ageDays: number;
  bucket: ReceivableBucket;
  stage: WorkingStage | null;
};

/**
 * Дебіторка по клієнтах із прив'язкою до торгового.
 *
 * Джерело — `Counterparty.receivableBalance`, тобто сальдо з 1С, а не
 * наші `Invoice`. Причина: рахунки в базі створює синхронізація оплат уже
 * закритими (сума = оплачено), непогашених там немає взагалі й не буде.
 * Реальний борг живе тільки в 1С.
 *
 * Прив'язка двоступенева: спершу закріплення клієнта за торговим, потім —
 * торговий з останнього документа продажу цьому клієнту. Порядок саме
 * такий, бо закріплення це рішення керівника, а документ — лише слід
 * того, хто возив востаннє.
 *
 * Обидва LATERAL повертають максимум один рядок, тож борг клієнта не
 * задвоюється між торговими.
 */
/**
 * Чи є вже колонка SalesDocument.docType.
 *
 * Розділення на замовлення й реалізації викочується поетапно: спершу
 * міграція, потім наповнення каналу з 1С, і лише потім код. Запити тут не
 * мають від цього падати — тому наявність колонки перевіряється, а не
 * припускається. Результат кешується на час життя процесу: колонка не
 * зникає, а зайвий запит до information_schema на кожен рядок дорогий.
 *
 * УВАГА: перевіряється лише КОЛОНКА. Значення 'RETURN' зʼявилось у типі
 * пізніше (міграція 20260811200000), тож на базі з колонкою, але без цього
 * значення, звертання до нього впало б. Обидві міграції вже застосовані
 * скрізь, тож окрема перевірка не потрібна — але нове значення enum, якщо
 * таке колись додаватимуть, теж вимагатиме своєї міграції ПЕРЕД кодом.
 */
let docTypeColumnCache: boolean | null = null;

async function hasDocTypeColumn(): Promise<boolean> {
  if (docTypeColumnCache !== null) return docTypeColumnCache;

  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'SalesDocument' AND column_name = 'docType'
    ) AS exists
  `;
  docTypeColumnCache = rows[0]?.exists ?? false;
  return docTypeColumnCache;
}

export async function receivableRowsByRep(
  repId?: string | null,
  now: Date = new Date()
): Promise<ReceivableRow[]> {
  const hasDocType = await hasDocTypeColumn();

  // Реалізація виграє над замовленням, коли обидва є в того самого клієнта.
  const realizationFirst = hasDocType
    ? Prisma.sql`("docType" = 'REALIZATION') DESC,`
    : Prisma.empty;

  // Повернення не визначає, чий це клієнт.
  const returnGuard = hasDocType ? Prisma.sql`AND "docType" <> 'RETURN'` : Prisma.empty;

  // У списку відвантажень тип має бути ОДИН: замовлення й реалізація на ту
  // саму партію подвоїли б масу документів, і борг виглядав би молодшим.
  // Але поки реалізацій немає, жорсткий фільтр лишив би список порожнім і
  // весь борг став би «понад 90 днів» — мовчки й неправильно. Тому вибір
  // робиться на рівні клієнта й самозачищається після наповнення каналу.
  const shipmentTypeFilter = hasDocType
    ? Prisma.sql`AND s."docType" = (
        SELECT CASE WHEN bool_or(s2."docType" = 'REALIZATION')
                    THEN 'REALIZATION' ELSE 'ORDER' END::"SalesDocType"
        FROM "SalesDocument" s2
        WHERE s2."counterpartyId" = c.id
          AND s2."externalId" IS NOT NULL
          AND s2.status = 'CONFIRMED'
      )`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<
    Array<Omit<ReceivableRow, "aged" | "unknownDebt"> & { shipments: Array<{ date: string; amount: number }> }>
  >`
    SELECT
      c.id                  AS "counterpartyId",
      c.name                AS "clientName",
      c.code                AS "clientCode",
      c."receivableBalance"::float AS debt,
      c."balanceSyncedAt"    AS "syncedAt",
      sd."createdAt"         AS "lastDocAt",
      COALESCE(rc."salesRepId", sd."salesRepId") AS "repId",
      COALESCE(sh.shipments, '[]'::json) AS shipments
    FROM "Counterparty" c
    LEFT JOIN LATERAL (
      SELECT "salesRepId" FROM "SalesRepClient"
      WHERE "counterpartyId" = c.id
      ORDER BY id
      LIMIT 1
    ) rc ON TRUE
    LEFT JOIN LATERAL (
      -- Реалізації пріоритетніші за замовлення, але поки їх немає —
      -- беремо будь-який документ, інакше борг лишиться без торгового.
      -- Слід про те, хто веде клієнта, лишає й замовлення.
      --
      -- Повернення сюди не рахується: воно теж «останній документ», але
      -- оформити його міг хто завгодно, і клієнт перекинувся б на чужого
      -- торгового разом з усім боргом.
      SELECT "salesRepId", "createdAt" FROM "SalesDocument"
      WHERE "counterpartyId" = c.id AND "salesRepId" IS NOT NULL
        ${returnGuard}
      ORDER BY ${realizationFirst} "createdAt" DESC
      LIMIT 1
    ) sd ON TRUE
    LEFT JOIN LATERAL (
      -- Відвантаження від найновішого: борг гаситься за FIFO, тож
      -- непогашеною лишається саме свіжа частина.
      SELECT json_agg(json_build_object('date', s."createdAt", 'amount', s."totalAmount")
                      ORDER BY s."createdAt" DESC) AS shipments
      FROM "SalesDocument" s
      WHERE s."counterpartyId" = c.id
        AND s."externalId" IS NOT NULL
        AND s.status = 'CONFIRMED'
        ${shipmentTypeFilter}
    ) sh ON TRUE
    WHERE c."receivableBalance" > 0.01
  `;

  const withAge = rows.map((r) => ({
    ...r,
    ...spreadDebtOverShipments(r.debt, r.shipments, now),
  }));

  // Фільтр по торговому — у JS, а не в SQL: запит однаковий для зведеної
  // таблиці і для drill-down, а «нічийні» борги потрібні окремо.
  return repId ? withAge.filter((r) => r.repId === repId) : withAge;
}

/** Прострочка одного клієнта — для екранів, що працюють зі списком клієнтів. */
export type CounterpartyAging = {
  /** Загальний борг за даними 1С */
  debt: number;
  /** Сума, що вийшла за відстрочку */
  overdue: number;
  /** Сума в межах відстрочки (товар ще їде або гроші заберуть наступного разу) */
  current: number;
  /** Вік найстарішої непогашеної частини, днів */
  oldestDays: number;
};

/**
 * Старіння боргу для конкретного набору клієнтів.
 *
 * Навіщо окремо від `receivableRowsByRep`: та функція відповідає на питання
 * «чия це дебіторка» і задля цього тягне прив'язку до торгового по ВСІХ
 * боржниках одразу. Карті водія, планувальнику маршруту й картці клієнта
 * потрібне інше — прострочка кількох конкретних клієнтів, без жодного
 * стосунку до того, хто їх веде.
 *
 * Головне ж: до появи цієї функції такі екрани брали розбивку з полів
 * `debtOverdue30/60/90/90Plus`, які 1С не надсилає ЖОДНОГО разу — вони
 * порожні у всіх контрагентів. Тому прострочка там завжди показувалась
 * нулем, тоді як аналітика рахувала її з відвантажень і давала інше число.
 * Два екрани про той самий борг суперечили один одному.
 */
export async function agingByCounterparty(
  counterpartyIds: string[] | null,
  now: Date = new Date()
): Promise<Map<string, CounterpartyAging>> {
  const result = new Map<string, CounterpartyAging>();
  if (counterpartyIds !== null && counterpartyIds.length === 0) return result;

  const hasDocType = await hasDocTypeColumn();

  // Той самий вибір типу документа, що в receivableRowsByRep: замовлення й
  // реалізація на ту саму партію подвоїли б список відвантажень, і борг
  // виглядав би молодшим, ніж є.
  const shipmentTypeFilter = hasDocType
    ? Prisma.sql`AND s."docType" = (
        SELECT CASE WHEN bool_or(s2."docType" = 'REALIZATION')
                    THEN 'REALIZATION' ELSE 'ORDER' END::"SalesDocType"
        FROM "SalesDocument" s2
        WHERE s2."counterpartyId" = c.id
          AND s2."externalId" IS NOT NULL
          AND s2.status = 'CONFIRMED'
      )`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      counterpartyId: string;
      debt: number;
      shipments: Array<{ date: string; amount: number }>;
    }>
  >`
    SELECT
      c.id                          AS "counterpartyId",
      c."receivableBalance"::float  AS debt,
      COALESCE(sh.shipments, '[]'::json) AS shipments
    FROM "Counterparty" c
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('date', s."createdAt", 'amount', s."totalAmount")
                      ORDER BY s."createdAt" DESC) AS shipments
      FROM "SalesDocument" s
      WHERE s."counterpartyId" = c.id
        AND s."externalId" IS NOT NULL
        AND s.status = 'CONFIRMED'
        ${shipmentTypeFilter}
    ) sh ON TRUE
    WHERE c."receivableBalance" > 0.01
      -- null означає «всі боржники»: списку в 3000 клієнтів дешевше взяти
      -- одним запитом і зіставити в пам'яті, ніж робити LATERAL на кожного.
      AND (${counterpartyIds}::text[] IS NULL OR c.id = ANY(${counterpartyIds}::text[]))
  `;

  for (const row of rows) {
    const { aged, unknownDebt } = spreadDebtOverShipments(row.debt, row.shipments, now);

    let overdue = unknownDebt; // борг без відвантажень старший за нашу історію
    let current = 0;
    let oldestDays = unknownDebt > 0.01 ? OLDER_THAN_HISTORY_DAYS : 0;

    for (const slice of aged) {
      if (slice.bucket === "CURRENT") current += slice.amount;
      else overdue += slice.amount;
      if (slice.ageDays > oldestDays) oldestDays = slice.ageDays;
    }

    result.set(row.counterpartyId, { debt: row.debt, overdue, current, oldestDays });
  }

  return result;
}

/**
 * Вік, який приписуємо боргу без жодного відвантаження в базі.
 *
 * Документи є з травня, тож такий борг старший за нашу історію — і саме він
 * найпроблемніший. Показувати його «свіжим» було б найгіршим варіантом.
 */
const OLDER_THAN_HISTORY_DAYS = 999;

/**
 * Розкладає борг клієнта по його відвантаженнях, щоб дізнатися вік.
 *
 * 1С віддає борг одним числом без прив'язки до накладних, тож вік
 * доводиться відновлювати: гасимо борг найновішими відвантаженнями, доки
 * він не вичерпається. Це припущення FIFO — клієнти гасять старі
 * поставки першими, тож непогашеною висить остання.
 *
 * Борг, під який відвантажень не вистачило, потрапляє в `unknownDebt`:
 * він старший за нашу історію (документи є лише з травня), а такий борг
 * найнебезпечніший — тому далі його рахують як прострочений понад 90 днів.
 */
export function spreadDebtOverShipments(
  debt: number,
  shipments: Array<{ date: string | Date; amount: number }>,
  now: Date = new Date()
): { aged: AgedSlice[]; unknownDebt: number } {
  const aged: AgedSlice[] = [];
  let left = debt;

  for (const s of shipments) {
    if (left <= 0.01) break;

    const amount = Math.min(left, s.amount);
    if (amount <= 0.01) continue;

    const ageDays = Math.max(
      0,
      Math.floor((now.getTime() - new Date(s.date).getTime()) / 86_400_000)
    );

    aged.push({
      amount,
      ageDays,
      bucket: bucketForAge(ageDays),
      stage: stageForAge(ageDays),
    });
    left -= amount;
  }

  return { aged, unknownDebt: Math.max(0, left) };
}

/**
 * Зводить борги в структуру старіння.
 *
 * Борг без відвантажень у базі (`unknownDebt`) зараховується як
 * прострочений понад 90 днів: документи в нас є з травня, тож борг, під
 * який їх не знайшлося, старший за це. Показувати його «робочим» було б
 * найгіршим варіантом — саме такі борги найпроблемніші.
 */
export function sumAging(rows: ReceivableRow[]): AgingResult {
  const buckets: AgingResult["buckets"] = {
    CURRENT: 0,
    OVERDUE_30: 0,
    OVERDUE_60: 0,
    OVERDUE_90: 0,
    OVERDUE_90_PLUS: 0,
  };
  const stages: AgingResult["stages"] = { DELIVERY: 0, AWAITING_PAYMENT: 0 };

  let total = 0;
  let unknown = 0;

  for (const row of rows) {
    total += row.debt;
    unknown += row.unknownDebt;
    buckets.OVERDUE_90_PLUS += row.unknownDebt;

    for (const slice of row.aged) {
      buckets[slice.bucket] += slice.amount;
      if (slice.stage) stages[slice.stage] += slice.amount;
    }
  }

  const overdue =
    buckets.OVERDUE_30 + buckets.OVERDUE_60 + buckets.OVERDUE_90 + buckets.OVERDUE_90_PLUS;

  return {
    total,
    current: buckets.CURRENT,
    overdue,
    overdueRatio: total > 0 ? (overdue / total) * 100 : 0,
    buckets,
    stages,
    unknown,
  };
}

/** Старіння дебіторки по кожному торговому. */
export function agingByRep(rows: ReceivableRow[]): Map<string, AgingResult> {
  const byRep = new Map<string, ReceivableRow[]>();
  for (const row of rows) {
    if (!row.repId) continue;
    const list = byRep.get(row.repId) ?? [];
    list.push(row);
    byRep.set(row.repId, list);
  }

  const result = new Map<string, AgingResult>();
  for (const [rep, list] of byRep) {
    result.set(rep, sumAging(list));
  }
  return result;
}

export type DebtorClient = {
  counterpartyId: string;
  name: string;
  code: string | null;
  debt: number;
  overdue: number;
  current: number;
  buckets: Record<ReceivableBucket, number>;
  stages: Record<WorkingStage, number>;
  /** Вік найстарішої непогашеної частини; null — вік невідомий */
  oldestDays: number | null;
  /** Борг без відвантажень у базі — старший за нашу історію */
  unknownDebt: number;
  /** Коли клієнт востаннє щось брав — підказка, чи борг «живий» */
  lastDocAt: string | null;
};

export type DebtDelta = {
  repId: string;
  /** Сальдо на початок періоду */
  opening: number;
  /** Сальдо на кінець періоду */
  closing: number;
  /** closing − opening: додатне означає, що борг виріс */
  delta: number;
  /** Чи є знімок на початок періоду; без нього приріст рахувати нема від чого */
  hasOpening: boolean;
};

/**
 * Наскільки за період виріс борг клієнтів кожного торгового.
 *
 * Це різниця двох знімків, а не сума операцій: 1С віддає сальдо, а не
 * рух по ньому. Знімок на початок беремо останній ПЕРЕД періодом —
 * обмін іде раз на день і в потрібну дату може не потрапити.
 *
 * Прив'язка клієнта до торгового — поточна, не історична: якщо клієнта
 * передали іншому торговому, весь його борг поїде за ним. Так і має
 * бути — відповідає той, хто веде клієнта зараз.
 */
export async function debtDeltaByRep(from: Date, to: Date): Promise<Map<string, DebtDelta>> {
  const hasDocType = await hasDocTypeColumn();
  const realizationFirst = hasDocType
    ? Prisma.sql`("docType" = 'REALIZATION') DESC,`
    : Prisma.empty;
  // Як і в receivableRowsByRep: повернення не робить клієнта чиїмось.
  const returnGuard = hasDocType ? Prisma.sql`AND "docType" <> 'RETURN'` : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{ repId: string; opening: number; closing: number; withOpening: number }>
  >`
    WITH client_rep AS (
      SELECT c.id AS "counterpartyId",
             COALESCE(rc."salesRepId", sd."salesRepId") AS "repId"
      FROM "Counterparty" c
      LEFT JOIN LATERAL (
        SELECT "salesRepId" FROM "SalesRepClient"
        WHERE "counterpartyId" = c.id ORDER BY id LIMIT 1
      ) rc ON TRUE
      LEFT JOIN LATERAL (
        SELECT "salesRepId" FROM "SalesDocument"
        WHERE "counterpartyId" = c.id AND "salesRepId" IS NOT NULL
          ${returnGuard}
        ORDER BY ${realizationFirst} "createdAt" DESC LIMIT 1
      ) sd ON TRUE
    ),
    opening AS (
      SELECT DISTINCT ON (s."counterpartyId") s."counterpartyId", s.balance
      FROM "DebtSnapshot" s
      WHERE s.day < ${from}
      ORDER BY s."counterpartyId", s.day DESC
    ),
    closing AS (
      SELECT DISTINCT ON (s."counterpartyId") s."counterpartyId", s.balance
      FROM "DebtSnapshot" s
      WHERE s.day <= ${to}
      ORDER BY s."counterpartyId", s.day DESC
    )
    SELECT
      cr."repId" AS "repId",
      COALESCE(SUM(o.balance), 0)::float AS opening,
      COALESCE(SUM(cl.balance), 0)::float AS closing,
      COUNT(o."counterpartyId")::int AS "withOpening"
    FROM client_rep cr
    LEFT JOIN opening o  ON o."counterpartyId"  = cr."counterpartyId"
    LEFT JOIN closing cl ON cl."counterpartyId" = cr."counterpartyId"
    WHERE cr."repId" IS NOT NULL
      AND (o."counterpartyId" IS NOT NULL OR cl."counterpartyId" IS NOT NULL)
    GROUP BY cr."repId"
  `;

  return new Map(
    rows.map((r) => [
      r.repId,
      {
        repId: r.repId,
        opening: r.opening,
        closing: r.closing,
        delta: r.closing - r.opening,
        hasOpening: r.withOpening > 0,
      },
    ])
  );
}

/** Боржники для UI: найгірші зверху — спершу за простроченою, потім за сумою. */
export function toDebtorList(rows: ReceivableRow[]): DebtorClient[] {
  return rows
    .map((r) => {
      const aging = sumAging([r]);
      // Найстарший шматок боргу — те, про що передусім питати клієнта
      const oldest = r.aged.reduce((max, s) => Math.max(max, s.ageDays), 0);

      return {
        counterpartyId: r.counterpartyId,
        name: r.clientName,
        code: r.clientCode,
        debt: r.debt,
        overdue: aging.overdue,
        current: aging.current,
        buckets: aging.buckets,
        stages: aging.stages,
        /** Вік найстарішої непогашеної частини, днів */
        oldestDays: r.unknownDebt > 0.01 ? null : oldest,
        /** Борг без відвантажень у базі — старший за нашу історію */
        unknownDebt: r.unknownDebt,
        lastDocAt: r.lastDocAt ? new Date(r.lastDocAt).toISOString() : null,
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.debt - a.debt);
}
