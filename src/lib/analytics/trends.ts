/**
 * Динаміка продажів торгового: як змінюється темп у часі.
 *
 * Наявні факти (facts.ts) відповідають на питання «скільки за період».
 * Тут інше питання — «краще чи гірше, ніж було». Керівник дивиться не на
 * оборот, а на його зміну: 300 тис. на місяць — це добре чи це падіння з
 * 500 тис.? Без порівняння вікон цього не видно ніде в дашборді.
 *
 * Фільтр джерела — той самий SOURCE_FILTER, що в усій аналітиці: інакше
 * «динаміка обороту» показувала б тренд не тих чисел, що стоять поруч
 * на картці.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SOURCE_FILTER, SALES_ONLY } from "@/lib/analytics/facts";
import type { Period } from "@/lib/analytics/period";

/**
 * Ширина вікна порівняння — 4 тижні проти попередніх 4.
 *
 * Надійна історія реалізацій починається з травня 2026, тобто на момент
 * написання це ~3,5 місяця. Вікно в квартал не дало б другої точки для
 * порівняння взагалі, а тиждень — це шум: один великий документ у
 * п'ятницю перевернув би висновок. Чотири тижні згладжують окремі угоди
 * й водночас лишають місце для двох вікон.
 */
export const MOMENTUM_WEEKS = 4;
const DAY_MS = 86_400_000;

export type TrendBucket = {
  /** YYYY-MM-DD — понеділок тижня або перше число місяця */
  bucket: string;
  amount: number;
  docs: number;
  clients: number;
  avgCheck: number;
};

export type Momentum = {
  /** Останні MOMENTUM_WEEKS тижнів */
  recent: { amount: number; docs: number; clients: number; avgCheck: number };
  /** Попередні MOMENTUM_WEEKS тижнів */
  previous: { amount: number; docs: number; clients: number; avgCheck: number };
  amountDeltaPct: number;
  docsDeltaPct: number;
  avgCheckDeltaPct: number;
  clientsDeltaPct: number;
  /**
   * false, якщо попереднє вікно виходить за межі наявної історії —
   * тоді відсотки не мають сенсу і показувати їх не можна.
   */
  comparable: boolean;
  /** Межі вікон, щоб інтерфейс міг чесно підписати, що з чим порівняно */
  recentFrom: string;
  previousFrom: string;
};

export type RepTrend = {
  repId: string;
  weekly: TrendBucket[];
  monthly: TrendBucket[];
  momentum: Momentum;
};

/** Найраніша реалізація в базі — межа, за якою порівнювати нема з чим. */
async function earliestDoc(): Promise<Date | null> {
  const rows = await prisma.$queryRaw<Array<{ first: Date | null }>>`
    SELECT MIN(s."createdAt") AS first
    FROM "SalesDocument" s
    WHERE ${SOURCE_FILTER}
  `;
  return rows[0]?.first ?? null;
}

/**
 * Розкладка обороту по тижнях або місяцях.
 *
 * date_trunc з AT TIME ZONE обов'язковий: документ, проведений о 23:30 за
 * Києвом, без цього потрапив би в наступну добу, а на межі тижня — і в
 * наступний тиждень.
 */
async function bucketsByRep(
  unit: "week" | "month",
  from: Date,
  to: Date,
  repId?: string | null
): Promise<Map<string, TrendBucket[]>> {
  const repCondition = repId ? Prisma.sql`AND s."salesRepId" = ${repId}` : Prisma.empty;
  const truncUnit = unit === "week" ? Prisma.sql`'week'` : Prisma.sql`'month'`;

  const rows = await prisma.$queryRaw<
    Array<{ repId: string; bucket: string; amount: number; docs: number; clients: number }>
  >`
    SELECT
      s."salesRepId" AS "repId",
      to_char(date_trunc(${truncUnit}, s."createdAt" AT TIME ZONE 'Europe/Kyiv'), 'YYYY-MM-DD') AS bucket,
      SUM(s."totalAmount")::float AS amount,
      COUNT(*) FILTER (WHERE ${SALES_ONLY})::int AS docs,
      COUNT(DISTINCT s."counterpartyId") FILTER (WHERE ${SALES_ONLY})::int AS clients
    FROM "SalesDocument" s
    WHERE ${SOURCE_FILTER}
      AND s."salesRepId" IS NOT NULL
      AND s."createdAt" >= ${from} AND s."createdAt" <= ${to}
      ${repCondition}
    GROUP BY 1, 2
    ORDER BY 2
  `;

  const map = new Map<string, TrendBucket[]>();
  for (const row of rows) {
    const list = map.get(row.repId) ?? [];
    list.push({
      bucket: row.bucket,
      amount: row.amount,
      docs: row.docs,
      clients: row.clients,
      avgCheck: row.docs > 0 ? row.amount / row.docs : 0,
    });
    map.set(row.repId, list);
  }
  return map;
}

type WindowRow = {
  repId: string;
  window: "recent" | "previous";
  amount: number;
  docs: number;
  clients: number;
};

/**
 * Обидва вікна одним запитом.
 *
 * Два окремі проходи по SalesDocument коштували б удвічі дорожче на
 * рівному місці — межа між вікнами відома наперед, тож CASE справляється.
 */
async function momentumWindows(
  recentFrom: Date,
  previousFrom: Date,
  to: Date,
  repId?: string | null
): Promise<Map<string, { recent: WindowRow | null; previous: WindowRow | null }>> {
  const repCondition = repId ? Prisma.sql`AND s."salesRepId" = ${repId}` : Prisma.empty;

  const rows = await prisma.$queryRaw<WindowRow[]>`
    SELECT
      s."salesRepId" AS "repId",
      CASE WHEN s."createdAt" >= ${recentFrom} THEN 'recent' ELSE 'previous' END AS window,
      SUM(s."totalAmount")::float AS amount,
      COUNT(*) FILTER (WHERE ${SALES_ONLY})::int AS docs,
      COUNT(DISTINCT s."counterpartyId") FILTER (WHERE ${SALES_ONLY})::int AS clients
    FROM "SalesDocument" s
    WHERE ${SOURCE_FILTER}
      AND s."salesRepId" IS NOT NULL
      AND s."createdAt" >= ${previousFrom} AND s."createdAt" <= ${to}
      ${repCondition}
    GROUP BY 1, 2
  `;

  const map = new Map<string, { recent: WindowRow | null; previous: WindowRow | null }>();
  for (const row of rows) {
    const acc = map.get(row.repId) ?? { recent: null, previous: null };
    acc[row.window] = row;
    map.set(row.repId, acc);
  }
  return map;
}

/** Зміна у відсотках. База 0 означає «не було нічого» — відсоток тут беззмістовний. */
function deltaPct(recent: number, previous: number): number {
  if (previous === 0) return 0;
  return ((recent - previous) / previous) * 100;
}

function emptyWindow() {
  return { amount: 0, docs: 0, clients: 0, avgCheck: 0 };
}

function toWindow(row: WindowRow | null) {
  if (!row) return emptyWindow();
  return {
    amount: row.amount,
    docs: row.docs,
    clients: row.clients,
    avgCheck: row.docs > 0 ? row.amount / row.docs : 0,
  };
}

function buildMomentum(
  pair: { recent: WindowRow | null; previous: WindowRow | null } | undefined,
  recentFrom: Date,
  previousFrom: Date,
  historyStart: Date | null
): Momentum {
  const recent = toWindow(pair?.recent ?? null);
  const previous = toWindow(pair?.previous ?? null);

  // Порівнювати можна лише тоді, коли попереднє вікно повністю вкладається
  // в наявну історію. Інакше «падіння на 60%» означало б лише те, що
  // половину вікна ми ще не збирали дані.
  const comparable = !!historyStart && historyStart.getTime() <= previousFrom.getTime();

  return {
    recent,
    previous,
    amountDeltaPct: deltaPct(recent.amount, previous.amount),
    docsDeltaPct: deltaPct(recent.docs, previous.docs),
    avgCheckDeltaPct: deltaPct(recent.avgCheck, previous.avgCheck),
    clientsDeltaPct: deltaPct(recent.clients, previous.clients),
    comparable,
    recentFrom: recentFrom.toISOString().slice(0, 10),
    previousFrom: previousFrom.toISOString().slice(0, 10),
  };
}

/**
 * Динаміка одного торгового.
 *
 * Тижні й місяці рахуються за обраний період, а momentum — завжди від
 * кінця періоду назад на 8 тижнів, незалежно від його ширини. Інакше на
 * періоді «останні 7 днів» порівнювати було б нічого.
 */
export async function repTrend(repId: string, period: Period): Promise<RepTrend> {
  const recentFrom = new Date(period.to.getTime() - MOMENTUM_WEEKS * 7 * DAY_MS);
  const previousFrom = new Date(period.to.getTime() - 2 * MOMENTUM_WEEKS * 7 * DAY_MS);

  const [weekly, monthly, windows, historyStart] = await Promise.all([
    bucketsByRep("week", period.from, period.to, repId),
    bucketsByRep("month", period.from, period.to, repId),
    momentumWindows(recentFrom, previousFrom, period.to, repId),
    earliestDoc(),
  ]);

  return {
    repId,
    weekly: weekly.get(repId) ?? [],
    monthly: monthly.get(repId) ?? [],
    momentum: buildMomentum(windows.get(repId), recentFrom, previousFrom, historyStart),
  };
}

/**
 * Momentum для всієї команди — для бенчмарку.
 *
 * Тижневі розкладки тут не потрібні: у командній таблиці рядок на людину,
 * а не графік на кожного, і тягнути сотні відер заради одного відсотка
 * було б марно.
 */
export async function momentumByRep(period: Period): Promise<Map<string, Momentum>> {
  const recentFrom = new Date(period.to.getTime() - MOMENTUM_WEEKS * 7 * DAY_MS);
  const previousFrom = new Date(period.to.getTime() - 2 * MOMENTUM_WEEKS * 7 * DAY_MS);

  const [windows, historyStart] = await Promise.all([
    momentumWindows(recentFrom, previousFrom, period.to),
    earliestDoc(),
  ]);

  const out = new Map<string, Momentum>();
  for (const [repId, pair] of windows) {
    out.set(repId, buildMomentum(pair, recentFrom, previousFrom, historyStart));
  }
  return out;
}
