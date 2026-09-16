/**
 * Базова оцінка: скільки клієнтів купили б і без повідомлення.
 *
 * «Після пропозиції замовили 18%» нічого не каже саме по собі: сплячі клієнти
 * повертаються і без жодного Viber, а активні купують щотижня. Порівнювати
 * треба з тим, як поводились такі самі клієнти, яким ніхто не писав.
 *
 * Як рахуємо. Беремо чотири зрізи в минулому — 28, 35, 42 і 49 днів тому
 * (D). На кожен зріз:
 *   - стан клієнта станом на кінець дня D — той самий classifyClient, що на
 *     карті й у картці торгового, по документах до кінця D;
 *   - «купив» — проведена реалізація в (D, D + ORDERED_WINDOW_DAYS + 1]:
 *     стільки ж днів, скільки має пропозиція (день відправки плюс 14, див.
 *     settle.ts), тобто зріз D відповідає пропозиції, надісланій у день D+1;
 *   - клієнтів, яким писали в (D − 30, D + 15], з оцінки прибираємо зовсім.
 *
 * Прибираємо, а не рахуємо «не купив». Ці клієнти отримали пропозицію, тож
 * вони не контрольна група; якби вони лишились у знаменнику як невдачі,
 * базова оцінка вийшла б нижчою, а пропозиції — кращими, ніж є.
 *
 * Найближчий зріз — 28 днів тому: його вікно закінчується за 13 днів до
 * сьогодні, і пізно проведені накладні встигають доїхати з 1С.
 *
 * Чотири зрізи замість одного — щоб один тиждень зі святом чи великою
 * поставкою не визначав оцінку. Рахуємо один раз на добу (SyncState
 * `outreach:baseline`): числа за минулі тижні за день не змінюються.
 *
 * Це ОЦІНКА, і в інтерфейсі вона так і підписується (BASELINE_NOTE).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { SOURCE_FILTER } from "@/lib/analytics/facts";
import { classifyClient, type ClientState } from "@/lib/analytics/clients";
import { shiftDay, type Period } from "@/lib/analytics/period";
import { kyivDate, kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";
import { isInternalClient, loadInternalContext } from "@/lib/rep-feed/internal";
import { getSyncState, setSyncState } from "@/lib/sync-ingest/context";
import { ORDERED_WINDOW_DAYS, QUIET_AFTER_OUTREACH_DAYS } from "./types";

export const BASELINE_KEY = "outreach:baseline";
export const BASELINE_NOTE = "оцінка: клієнт міг купити і без повідомлення";

/** Скільки днів тому кожен зріз. */
export const BASELINE_CUT_OFFSETS = [28, 35, 42, 49] as const;

const CACHE_MS = 24 * 60 * 60_000;

/** Вікно «нового клієнта» — те саме, що в nowPeriod (assistant/facts/client-state.ts). */
const NEW_WINDOW_DAYS = 30;

const STATES: ClientState[] = ["NEW", "ACTIVE", "SLIPPING", "DORMANT", "LOST"];

export type BaselineCell = {
  /** Клієнто-зрізів у вибірці: той самий клієнт на чотирьох зрізах — чотири. */
  clients: number;
  bought: number;
  /** bought / clients; null — нема з чого рахувати. */
  rate: number | null;
};

export type RepurchaseBaseline = {
  computedAt: string;
  /** Київські дні зрізів. */
  cuts: string[];
  /** Довжина вікна покупки в днях — та сама, що в пропозиції. */
  windowDays: number;
  byState: Record<ClientState, BaselineCell>;
  total: BaselineCell;
  /** Скільки клієнто-зрізів прибрано, бо їм писали. */
  excludedContacted: number;
  note: string;
};

type Row = {
  cut: string;
  counterpartyId: string;
  name: string;
  firstDocAt: Date | null;
  lastDocAt: Date | null;
  historyDocs: number;
  historyDays: number;
  bought: boolean;
  contacted: boolean;
};

function ts(d: Date): string {
  return d.toISOString().replace("Z", "");
}

/** Період «станом на кінець дня cut» — як nowPeriod, лише в минулому. */
function periodAt(cut: string): Period {
  const fromDay = shiftDay(cut, -(NEW_WINDOW_DAYS - 1));
  return {
    fromDay,
    toDay: cut,
    from: kyivDayStart(fromDay),
    to: kyivDayEnd(cut),
    days: NEW_WINDOW_DAYS,
    clamped: false,
  };
}

function cell(clients: number, bought: number): BaselineCell {
  return { clients, bought, rate: clients > 0 ? bought / clients : null };
}

async function computeBaseline(now: Date): Promise<RepurchaseBaseline> {
  const today = kyivDate(now);
  const cuts = BASELINE_CUT_OFFSETS.map((d) => shiftDay(today, -d));

  /**
   * Межі — ті самі, що в clientPortfolioAll: дати документів порівнюються з
   * київськими межами доби (kyivDayEnd). Інакше стан на зрізі розійшовся б
   * зі станом, який у той день показувала карта.
   */
  const values = Prisma.join(
    cuts.map((cut) => {
      const histTo = kyivDayEnd(cut);
      const buyTo = kyivDayEnd(shiftDay(cut, ORDERED_WINDOW_DAYS + 1));
      const outFrom = kyivDayEnd(shiftDay(cut, -QUIET_AFTER_OUTREACH_DAYS));
      return Prisma.sql`(${cut}::text, ${ts(histTo)}::timestamp, ${ts(buyTo)}::timestamp, ${ts(outFrom)}::timestamp)`;
    })
  );

  const rows = await prisma.$queryRaw<Row[]>`
    WITH cuts(cut, hist_to, buy_to, out_from) AS (VALUES ${values}),
    docs AS (
      SELECT s."counterpartyId", s."createdAt", s."docType"
      FROM "SalesDocument" s
      WHERE ${SOURCE_FILTER}
        AND s."counterpartyId" IS NOT NULL
    ),
    hist AS (
      SELECT
        k.cut,
        d."counterpartyId",
        MIN(d."createdAt") FILTER (WHERE d."docType" <> 'RETURN') AS "firstDocAt",
        MAX(d."createdAt") FILTER (WHERE d."docType" <> 'RETURN') AS "lastDocAt",
        COUNT(*) FILTER (WHERE d."docType" <> 'RETURN')::int AS "historyDocs",
        COUNT(DISTINCT (d."createdAt" AT TIME ZONE 'Europe/Kyiv')::date)
          FILTER (WHERE d."docType" <> 'RETURN')::int AS "historyDays"
      FROM cuts k
      JOIN docs d ON d."createdAt" <= k.hist_to
      GROUP BY 1, 2
    )
    SELECT
      h.cut,
      h."counterpartyId",
      c.name,
      h."firstDocAt",
      h."lastDocAt",
      h."historyDocs",
      h."historyDays",
      EXISTS (
        SELECT 1 FROM "SalesDocument" s
        WHERE s."counterpartyId" = h."counterpartyId"
          AND s."docType" = 'REALIZATION'
          AND s.status = 'CONFIRMED'
          AND s."externalId" IS NOT NULL
          AND s."createdAt" > k.hist_to
          AND s."createdAt" <= k.buy_to
      ) AS bought,
      EXISTS (
        SELECT 1 FROM "ClientOutreach" o
        WHERE o."counterpartyId" = h."counterpartyId"
          AND o."sentAt" > k.out_from
          AND o."sentAt" <= k.buy_to
      ) AS contacted
    FROM hist h
    JOIN cuts k ON k.cut = h.cut
    JOIN "Counterparty" c ON c.id = h."counterpartyId"
    WHERE h."firstDocAt" IS NOT NULL
      AND NOT c."isInternal"
  `;

  // Ознака isInternal уже в SQL; назва («Склад (Дубляни)», «(торговий)») —
  // страховка для карток, які ще ніхто не позначив.
  const internal = await loadInternalContext();

  const acc = Object.fromEntries(STATES.map((s) => [s, { clients: 0, bought: 0 }])) as Record<
    ClientState,
    { clients: number; bought: number }
  >;
  let excludedContacted = 0;

  for (const r of rows) {
    if (!r.firstDocAt || !r.lastDocAt) continue;
    if (isInternalClient({ id: r.counterpartyId, name: r.name }, internal)) continue;
    if (r.contacted) {
      excludedContacted++;
      continue;
    }
    const state = classifyClient(
      {
        firstDocAt: r.firstDocAt,
        lastDocAt: r.lastDocAt,
        historyDocs: r.historyDocs,
        historyDays: r.historyDays,
      },
      periodAt(r.cut)
    );
    acc[state].clients++;
    if (r.bought) acc[state].bought++;
  }

  const byState = Object.fromEntries(STATES.map((s) => [s, cell(acc[s].clients, acc[s].bought)])) as Record<
    ClientState,
    BaselineCell
  >;
  const totalClients = STATES.reduce((n, s) => n + acc[s].clients, 0);
  const totalBought = STATES.reduce((n, s) => n + acc[s].bought, 0);

  return {
    computedAt: now.toISOString(),
    cuts,
    windowDays: ORDERED_WINDOW_DAYS + 1,
    byState,
    total: cell(totalClients, totalBought),
    excludedContacted,
    note: BASELINE_NOTE,
  };
}

function parseCached(raw: string | null, now: Date): RepurchaseBaseline | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RepurchaseBaseline;
    const at = Date.parse(parsed.computedAt);
    if (!Number.isFinite(at) || at > now.getTime() || now.getTime() - at >= CACHE_MS) return null;
    if (!parsed.byState || !parsed.total) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Базова оцінка повторної покупки по станах; з кешу, якщо він молодший за добу.
 * `fresh` — перерахувати попри кеш (скрипти).
 */
export async function repurchaseBaseline(
  now: Date = new Date(),
  opts: { fresh?: boolean } = {}
): Promise<RepurchaseBaseline> {
  if (!opts.fresh) {
    const cached = parseCached(await getSyncState(BASELINE_KEY), now);
    if (cached) return cached;
  }
  const result = await computeBaseline(now);
  await setSyncState(BASELINE_KEY, JSON.stringify(result));
  return result;
}
