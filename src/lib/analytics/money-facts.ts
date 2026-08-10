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
import type { AgingResult } from "@/lib/erp/receivables";

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
  /** Розбивка за строками; null — 1С її ще не вивантажує */
  current: number | null;
  overdue30: number | null;
  overdue60: number | null;
  overdue90: number | null;
  overdue90plus: number | null;
  /** Коли 1С востаннє оновила сальдо */
  syncedAt: Date | null;
  /** Дата останнього відвантаження — довідково, «коли востаннє брали товар» */
  lastDocAt: Date | null;
  /** null — борг не вдалося віднести до жодного торгового */
  repId: string | null;
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
export async function receivableRowsByRep(repId?: string | null): Promise<ReceivableRow[]> {
  const rows = await prisma.$queryRaw<ReceivableRow[]>`
    SELECT
      c.id                  AS "counterpartyId",
      c.name                AS "clientName",
      c.code                AS "clientCode",
      c."receivableBalance"::float AS debt,
      c."debtCurrent"::float       AS current,
      c."debtOverdue30"::float     AS overdue30,
      c."debtOverdue60"::float     AS overdue60,
      c."debtOverdue90"::float     AS overdue90,
      c."debtOverdue90Plus"::float AS overdue90plus,
      c."balanceSyncedAt"    AS "syncedAt",
      sd."createdAt"         AS "lastDocAt",
      COALESCE(rc."salesRepId", sd."salesRepId") AS "repId"
    FROM "Counterparty" c
    LEFT JOIN LATERAL (
      SELECT "salesRepId" FROM "SalesRepClient"
      WHERE "counterpartyId" = c.id
      ORDER BY id
      LIMIT 1
    ) rc ON TRUE
    LEFT JOIN LATERAL (
      SELECT "salesRepId", "createdAt" FROM "SalesDocument"
      WHERE "counterpartyId" = c.id AND "salesRepId" IS NOT NULL
      ORDER BY "createdAt" DESC
      LIMIT 1
    ) sd ON TRUE
    WHERE c."receivableBalance" > 0.01
  `;

  // Фільтр по торговому — у JS, а не в SQL: запит однаковий для зведеної
  // таблиці і для drill-down, а «нічийні» борги потрібні окремо.
  return repId ? rows.filter((r) => r.repId === repId) : rows;
}

/**
 * Зводить борги в структуру старіння.
 *
 * Розбивку не рахуємо самі — беремо ту, що дала 1С: у нас немає дат
 * окремих накладних, лише підсумкове сальдо по клієнту. Клієнти без
 * розбивки потрапляють у `unknown`: показати їх борг як «робочий» було б
 * брехнею, бо ми просто не знаємо його віку.
 */
export function sumAging(rows: ReceivableRow[]): AgingResult {
  const buckets: AgingResult["buckets"] = {
    CURRENT: 0,
    OVERDUE_30: 0,
    OVERDUE_60: 0,
    OVERDUE_90: 0,
    OVERDUE_90_PLUS: 0,
  };

  let total = 0;
  let unknown = 0;

  for (const row of rows) {
    total += row.debt;

    if (!hasAging(row)) {
      unknown += row.debt;
      continue;
    }

    buckets.CURRENT += row.current ?? 0;
    buckets.OVERDUE_30 += row.overdue30 ?? 0;
    buckets.OVERDUE_60 += row.overdue60 ?? 0;
    buckets.OVERDUE_90 += row.overdue90 ?? 0;
    buckets.OVERDUE_90_PLUS += row.overdue90plus ?? 0;
  }

  const overdue = buckets.OVERDUE_30 + buckets.OVERDUE_60 + buckets.OVERDUE_90 + buckets.OVERDUE_90_PLUS;
  const known = total - unknown;

  return {
    total,
    current: buckets.CURRENT,
    overdue,
    // Відсоток рахуємо від боргу з відомими строками: ділити на весь
    // борг означало б занижувати прострочку там, де 1С ще не віддала розбивку.
    overdueRatio: known > 0 ? (overdue / known) * 100 : 0,
    buckets,
    unknown,
  };
}

/** Чи прийшла для клієнта розбивка за строками. */
export function hasAging(row: ReceivableRow): boolean {
  return (
    row.current !== null ||
    row.overdue30 !== null ||
    row.overdue60 !== null ||
    row.overdue90 !== null ||
    row.overdue90plus !== null
  );
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
  /** Прострочена частина; null — 1С не дала розбивку для цього клієнта */
  overdue: number | null;
  current: number | null;
  buckets: Record<ReceivableBucket, number> | null;
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
        ORDER BY "createdAt" DESC LIMIT 1
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
      const known = hasAging(r);
      const overdue = known
        ? (r.overdue30 ?? 0) + (r.overdue60 ?? 0) + (r.overdue90 ?? 0) + (r.overdue90plus ?? 0)
        : null;

      return {
        counterpartyId: r.counterpartyId,
        name: r.clientName,
        code: r.clientCode,
        debt: r.debt,
        overdue,
        current: known ? r.current ?? 0 : null,
        buckets: known
          ? {
              CURRENT: r.current ?? 0,
              OVERDUE_30: r.overdue30 ?? 0,
              OVERDUE_60: r.overdue60 ?? 0,
              OVERDUE_90: r.overdue90 ?? 0,
              OVERDUE_90_PLUS: r.overdue90plus ?? 0,
            }
          : null,
        lastDocAt: r.lastDocAt ? new Date(r.lastDocAt).toISOString() : null,
      };
    })
    .sort((a, b) => (b.overdue ?? 0) - (a.overdue ?? 0) || b.debt - a.debt);
}
