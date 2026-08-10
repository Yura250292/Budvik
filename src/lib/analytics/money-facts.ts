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
import { calculateAging, bucketFor, overdueDaysFor, type AgingResult } from "@/lib/erp/receivables";

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
  invoiceId: string;
  number: string;
  /** Дата виставлення — від неї рахується вік боргу і прострочка */
  issuedAt: Date;
  /** Узгоджений строк оплати, якщо є. На старіння не впливає — лише довідка */
  dueDate: Date | null;
  debt: number;
  counterpartyId: string;
  clientName: string;
  /** null — рахунок не вдалося віднести до жодного торгового */
  repId: string | null;
};

/**
 * Непогашені рахунки з прив'язкою до торгового.
 *
 * Прив'язка двоступенева: спершу торговий із документа продажу, і лише
 * якщо його немає — торговий, за яким закріплений клієнт. Той самий
 * порядок, що й у рознесенні оплат, інакше «зібрав» і «винні» рахувалися
 * б по різних людях.
 *
 * LATERAL спрацьовує тільки коли в документі торгового немає, тож один
 * рахунок ніколи не потрапляє до двох торгових. ORDER BY id LIMIT 1 —
 * бо клієнт може бути закріплений за кількома: беремо детерміновано
 * першого, як робить apply-payments.
 */
export async function receivableRowsByRep(repId?: string | null): Promise<ReceivableRow[]> {
  const rows = await prisma.$queryRaw<ReceivableRow[]>`
    SELECT
      i.id              AS "invoiceId",
      i.number          AS "number",
      i."createdAt"     AS "issuedAt",
      i."dueDate"       AS "dueDate",
      (i."totalAmount" - i."paidAmount")::float AS debt,
      i."counterpartyId" AS "counterpartyId",
      c.name            AS "clientName",
      COALESCE(s."salesRepId", src."salesRepId") AS "repId"
    FROM "Invoice" i
    JOIN "Counterparty" c ON c.id = i."counterpartyId"
    LEFT JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    LEFT JOIN LATERAL (
      SELECT rc."salesRepId"
      FROM "SalesRepClient" rc
      WHERE rc."counterpartyId" = i."counterpartyId"
      ORDER BY rc.id
      LIMIT 1
    ) src ON s."salesRepId" IS NULL
    WHERE i."paymentStatus" IN ('UNPAID', 'PARTIAL')
      AND i.status <> 'CANCELLED'
      AND (i."totalAmount" - i."paidAmount") > 0.01
  `;

  // Фільтр по торговому — у JS, а не в SQL: запит однаковий для зведеної
  // таблиці і для drill-down, а «нічийні» рахунки потрібні окремо.
  return repId ? rows.filter((r) => r.repId === repId) : rows;
}

/** Борги у форматі, який приймає calculateAging. */
export function toAgingInput(rows: ReceivableRow[]) {
  return rows.map((r) => ({ amount: r.debt, issuedAt: new Date(r.issuedAt) }));
}

/** Старіння дебіторки по кожному торговому. */
export function agingByRep(rows: ReceivableRow[], now: Date = new Date()): Map<string, AgingResult> {
  const byRep = new Map<string, ReceivableRow[]>();
  for (const row of rows) {
    if (!row.repId) continue;
    const list = byRep.get(row.repId) ?? [];
    list.push(row);
    byRep.set(row.repId, list);
  }

  const result = new Map<string, AgingResult>();
  for (const [rep, list] of byRep) {
    result.set(rep, calculateAging(toAgingInput(list), now));
  }
  return result;
}

/** Порожнє старіння — для торгового, у якого дебіторки немає. */
export const EMPTY_AGING: AgingResult = {
  total: 0,
  current: 0,
  overdue: 0,
  overdueRatio: 0,
  buckets: { CURRENT: 0, OVERDUE_30: 0, OVERDUE_60: 0, OVERDUE_90: 0, OVERDUE_90_PLUS: 0 },
};

export type ReceivableInvoice = {
  id: string;
  number: string;
  client: string;
  counterpartyId: string;
  /** Дата рахунка — від неї рахується вік */
  issuedAt: string;
  /** Скільки днів борг узагалі висить */
  ageDays: number;
  debt: number;
  bucket: ReceivableBucket;
  /** Днів понад відстрочку; 0 — борг ще робочий */
  daysOverdue: number;
};

/** Кошики за тяжкістю — для сортування списку рахунків. */
const BUCKET_SEVERITY: Record<ReceivableBucket, number> = {
  OVERDUE_90_PLUS: 0,
  OVERDUE_90: 1,
  OVERDUE_60: 2,
  OVERDUE_30: 3,
  CURRENT: 4,
};

/** Рахунки у вигляді для UI: з кошиком, днями прострочки, від найгіршого. */
export function toInvoiceList(rows: ReceivableRow[], now: Date = new Date()): ReceivableInvoice[] {
  return rows
    .map((r) => {
      const issued = new Date(r.issuedAt);
      return {
        id: r.invoiceId,
        number: r.number,
        client: r.clientName,
        counterpartyId: r.counterpartyId,
        issuedAt: issued.toISOString(),
        ageDays: Math.max(0, Math.floor((now.getTime() - issued.getTime()) / 86_400_000)),
        debt: r.debt,
        bucket: bucketFor(issued, now),
        daysOverdue: overdueDaysFor(issued, now),
      };
    })
    .sort((a, b) => BUCKET_SEVERITY[a.bucket] - BUCKET_SEVERITY[b.bucket] || b.debt - a.debt);
}
