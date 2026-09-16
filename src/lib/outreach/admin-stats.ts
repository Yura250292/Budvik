/**
 * «Робота з базою» — числа для офісу на /admin/marketing.
 *
 * Сторінка відповідає на три питання.
 *
 * 1. Скільки в нас сплячих і чи є куди їм писати. Стани — ті самі, що на
 *    карті й у картці торгового (clientPortfolioAll → classifyClient), без
 *    своїх. Мобільний — outreachPhone, тобто саме той номер, на який торговий
 *    відправить Viber. Згода потрібна лише для розсилок; особисте
 *    повідомлення торгового її не потребує, тож «не питали» тут не вирок.
 *
 * 2. Чи працюють пропозиції. Частка «замовив» рахується лише серед ЗАКРИТИХ
 *    рекламних (purpose = MARKETING) пропозицій: відкрита ще може стати
 *    замовленням, і з нею в знаменнику свіжий тиждень завжди виглядав би
 *    провалом. Нагадування про борг у частку не входять — після них клієнт
 *    платить, а не купує. Поруч стоїть базова оцінка (baseline.ts): скільки
 *    таких самих клієнтів купили без жодного повідомлення. Без неї «20%»
 *    читалося б як успіх, навіть якщо сплячі повертаються з тією ж частотою
 *    самі.
 *
 * 3. Хто за них відповідає. Таблиця торгових і «Нічийні сплячі» — клієнти, не
 *    закріплені ні за ким. Їм не прийде ні список дзвінків, ні вівторкова
 *    підказка: обидва читають закріплення.
 *
 * Оборот «під ризиком» — за 12 місяців (не раніше межі аналітики), а не за
 * обраний період: сплячий за визначенням 60+ днів без документа, і за
 * 30-денний період його оборот завжди нуль.
 */

import { prisma } from "@/lib/prisma";
import { clientPortfolioAll, type ClientState } from "@/lib/analytics/clients";
import { clampFrom, SOURCE_FILTER } from "@/lib/analytics/facts";
import type { Period } from "@/lib/analytics/period";
import { kyivDate } from "@/lib/date/kyiv";
import { isInternalClient, loadInternalContext } from "@/lib/rep-feed/internal";
import { refusesMessages } from "@/lib/rep-feed/outreach-list";
import { repurchaseBaseline, type RepurchaseBaseline } from "./baseline";
import { isOutreachTableMissing } from "./settle";
import { outreachPhone, QUIET_AFTER_OUTREACH_DAYS } from "./types";

/** Вікно обороту «під ризиком» і сортування нічийних. */
export const REVENUE_WINDOW_DAYS = 365;
/** Скільки нічийних показуємо: далі — клієнти з нульовим оборотом за рік. */
export const UNOWNED_LIMIT = 200;
export const RECENT_LIMIT = 50;

const DAY_MS = 86_400_000;
const STATES: ClientState[] = ["NEW", "ACTIVE", "SLIPPING", "DORMANT", "LOST"];

export type ConversionCell = { closed: number; ordered: number; rate: number | null };

export type MarketingTiles = {
  /** Клієнтів з історією покупок, без своїх. */
  clients: number;
  states: Record<ClientState, number>;
  withMobile: number;
  /** Сплячі й втрачені з мобільним — кому реально можна написати. */
  sleepingWithMobile: number;
  consent: { GRANTED: number; REFUSED: number; UNKNOWN: number };
  /** Відписка, згода REFUSED або канал «не турбувати». */
  refusing: number;
  /** Пропозицій за період (усі види й призначення). */
  offers: number;
  offerClients: number;
  byOutcome: Record<string, number>;
  marketing: {
    sent: number;
    pending: number;
    closed: number;
    ordered: number;
    /** ordered / closed; null — закритих ще немає. */
    rate: number | null;
    orderedAmount: number;
  };
  /** Конверсія закритих рекламних пропозицій за станом клієнта в мить відправки. */
  conversionByState: Record<ClientState, ConversionCell>;
};

export type RepMarketingRow = {
  repId: string;
  name: string;
  assigned: number;
  dormant: number;
  lost: number;
  offers: number;
  /** Різних клієнтів, яким торговий писав за період. */
  contacted: number;
  /** Різних клієнтів, у яких пропозиція закрилась замовленням. */
  converted: number;
  orderedAmount: number;
  /** Оборот за 12 місяців закріплених сплячих і втрачених. */
  revenueAtRisk: number;
};

export type UnownedClientRow = {
  counterpartyId: string;
  name: string;
  state: "DORMANT" | "LOST";
  hasMobile: boolean;
  /** Дата останньої покупки з 1С, «YYYY-MM-DD». */
  lastDocDay: string;
  daysSinceLast: number;
  revenue: number;
  /** Торговий з останньої накладної, де він проставлений (будь-яка роль). */
  lastRep: { id: string; name: string; role: string } | null;
};

export type RecentOutreachRow = {
  id: string;
  sentAt: string;
  repName: string | null;
  counterpartyId: string;
  counterpartyName: string;
  kind: string;
  channel: string;
  purpose: string;
  outcome: string;
  outcomeBy: string | null;
  outcomeAt: string | null;
  outcomeAmount: number | null;
};

export type MarketingBaseStats = {
  period: { fromDay: string; toDay: string; days: number; clamped: boolean };
  revenueSinceDay: string;
  tiles: MarketingTiles;
  baseline: RepurchaseBaseline | null;
  baselineError: string | null;
  reps: RepMarketingRow[];
  unowned: { total: number; withMobile: number; revenue: number; limit: number; rows: UnownedClientRow[] };
  recent: RecentOutreachRow[];
  salesReps: { id: string; name: string }[];
};

function emptyStates<T>(make: () => T): Record<ClientState, T> {
  return Object.fromEntries(STATES.map((s) => [s, make()])) as Record<ClientState, T>;
}

/** Оборот нетто по клієнтах від дати: той самий SOURCE_FILTER, що в усій аналітиці. */
async function revenueByCounterparty(from: Date): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ counterpartyId: string; amount: number }[]>`
    SELECT s."counterpartyId", SUM(s."totalAmount")::float AS amount
    FROM "SalesDocument" s
    WHERE ${SOURCE_FILTER}
      AND s."counterpartyId" IS NOT NULL
      AND s."createdAt" >= ${from}
    GROUP BY 1
  `;
  return new Map(rows.map((r) => [r.counterpartyId, r.amount]));
}

/**
 * Хто з торгових востаннє оформлював клієнтові реалізацію.
 *
 * Підказка офісу, кому віддати нічийного: людина, яка вже його знає. Беремо
 * останню накладну з проставленим торговим, а не просто останню: у частини
 * документів 1С торговий порожній, і тоді підказки не було б узагалі.
 * Роль повертаємо — закріпити можна лише за SALES, а в накладних буває й офіс.
 */
async function lastDocReps(ids: string[]): Promise<Map<string, { id: string; name: string; role: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<{ counterpartyId: string; id: string; name: string; role: string }[]>`
    SELECT DISTINCT ON (s."counterpartyId")
      s."counterpartyId", u.id, u.name, u.role::text AS role
    FROM "SalesDocument" s
    JOIN "User" u ON u.id = s."salesRepId"
    WHERE s."externalId" IS NOT NULL
      AND s.status = 'CONFIRMED'
      AND s."docType" = 'REALIZATION'
      AND s."counterpartyId" = ANY(${ids}::text[])
    ORDER BY s."counterpartyId", s."createdAt" DESC
  `;
  return new Map(rows.map((r) => [r.counterpartyId, { id: r.id, name: r.name, role: r.role }]));
}

export async function marketingBaseStats(period: Period, now: Date = new Date()): Promise<MarketingBaseStats> {
  const revenueFrom = clampFrom(new Date(now.getTime() - REVENUE_WINDOW_DAYS * DAY_MS));
  const quietFrom = new Date(now.getTime() - QUIET_AFTER_OUTREACH_DAYS * DAY_MS);

  let baselineError: string | null = null;
  const baselinePromise = repurchaseBaseline(now).catch((e: unknown) => {
    if (isOutreachTableMissing(e)) throw e;
    console.error("[marketing] базова оцінка впала:", e);
    baselineError = "Базову оцінку не вдалося порахувати";
    return null;
  });

  const [portfolio, internal, revenue, salesReps, assignments, periodOffers, recentlyContacted, recentRows, baseline] =
    await Promise.all([
      clientPortfolioAll(period),
      loadInternalContext(),
      revenueByCounterparty(revenueFrom),
      prisma.user.findMany({ where: { role: "SALES" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.salesRepClient.findMany({
        where: { salesRep: { role: "SALES" } },
        select: { salesRepId: true, counterpartyId: true },
      }),
      prisma.clientOutreach.findMany({
        where: { sentAt: { gte: period.from, lte: period.to } },
        select: {
          repId: true,
          counterpartyId: true,
          outcome: true,
          purpose: true,
          stateAtSend: true,
          outcomeAmount: true,
        },
      }),
      prisma.clientOutreach.findMany({
        where: { sentAt: { gte: quietFrom } },
        select: { counterpartyId: true },
        distinct: ["counterpartyId"],
      }),
      prisma.clientOutreach.findMany({
        orderBy: { sentAt: "desc" },
        take: RECENT_LIMIT,
        select: {
          id: true,
          sentAt: true,
          kind: true,
          channel: true,
          purpose: true,
          outcome: true,
          outcomeBy: true,
          outcomeAt: true,
          outcomeAmount: true,
          counterpartyId: true,
          counterparty: { select: { name: true } },
          rep: { select: { name: true } },
        },
      }),
      baselinePromise,
    ]);

  // Ознаку isInternal SQL портфеля вже врахував; назва — страховка для
  // щойно заведених карток «Склад (…)», «(торговий)».
  const clients = portfolio.clients.filter((c) => !isInternalClient({ id: c.counterpartyId, name: c.name }, internal));
  const contacts = new Map(
    (
      await prisma.counterparty.findMany({
        where: { id: { in: clients.map((c) => c.counterpartyId) } },
        select: {
          id: true,
          phone: true,
          primaryPhoneE164: true,
          marketingConsent: true,
          marketingOptOutAt: true,
          preferredChannel: true,
        },
      })
    ).map((c) => [c.id, c])
  );
  const hasMobile = (id: string) => {
    const c = contacts.get(id);
    return !!c && outreachPhone(c) !== null;
  };

  // ---- плитки ----
  const states = emptyStates(() => 0);
  const consent = { GRANTED: 0, REFUSED: 0, UNKNOWN: 0 };
  let withMobile = 0;
  let sleepingWithMobile = 0;
  let refusing = 0;
  for (const c of clients) {
    states[c.state]++;
    const info = contacts.get(c.counterpartyId);
    const mobile = hasMobile(c.counterpartyId);
    if (mobile) withMobile++;
    if (mobile && (c.state === "DORMANT" || c.state === "LOST")) sleepingWithMobile++;
    const k = info?.marketingConsent === "GRANTED" || info?.marketingConsent === "REFUSED" ? info.marketingConsent : "UNKNOWN";
    consent[k]++;
    if (info && refusesMessages(info)) refusing++;
  }

  const byOutcome: Record<string, number> = {};
  for (const o of periodOffers) byOutcome[o.outcome] = (byOutcome[o.outcome] ?? 0) + 1;

  const marketingOffers = periodOffers.filter((o) => o.purpose === "MARKETING");
  const closed = marketingOffers.filter((o) => o.outcome !== "PENDING");
  const orderedOffers = closed.filter((o) => o.outcome === "ORDERED");
  const conversionByState = emptyStates<ConversionCell>(() => ({ closed: 0, ordered: 0, rate: null }));
  for (const o of closed) {
    const cellState = STATES.find((s) => s === o.stateAtSend);
    if (!cellState) continue;
    conversionByState[cellState].closed++;
    if (o.outcome === "ORDERED") conversionByState[cellState].ordered++;
  }
  for (const s of STATES) {
    const cell = conversionByState[s];
    cell.rate = cell.closed > 0 ? cell.ordered / cell.closed : null;
  }

  const tiles: MarketingTiles = {
    clients: clients.length,
    states,
    withMobile,
    sleepingWithMobile,
    consent,
    refusing,
    offers: periodOffers.length,
    offerClients: new Set(periodOffers.map((o) => o.counterpartyId)).size,
    byOutcome,
    marketing: {
      sent: marketingOffers.length,
      pending: marketingOffers.length - closed.length,
      closed: closed.length,
      ordered: orderedOffers.length,
      rate: closed.length > 0 ? orderedOffers.length / closed.length : null,
      orderedAmount: orderedOffers.reduce((sum, o) => sum + (o.outcomeAmount ?? 0), 0),
    },
    conversionByState,
  };

  // ---- торгові ----
  const stateById = new Map(clients.map((c) => [c.counterpartyId, c.state]));
  const assignedByRep = new Map<string, string[]>();
  for (const a of assignments) {
    const list = assignedByRep.get(a.salesRepId) ?? [];
    list.push(a.counterpartyId);
    assignedByRep.set(a.salesRepId, list);
  }
  const reps: RepMarketingRow[] = salesReps.map((r) => {
    const assigned = (assignedByRep.get(r.id) ?? []).filter((id) => !internal.ids.has(id));
    let dormant = 0;
    let lost = 0;
    let revenueAtRisk = 0;
    for (const id of assigned) {
      const s = stateById.get(id);
      if (s === "DORMANT") dormant++;
      if (s === "LOST") lost++;
      if (s === "DORMANT" || s === "LOST") revenueAtRisk += revenue.get(id) ?? 0;
    }
    const mine = periodOffers.filter((o) => o.repId === r.id);
    const ordered = mine.filter((o) => o.outcome === "ORDERED");
    return {
      repId: r.id,
      name: r.name,
      assigned: assigned.length,
      dormant,
      lost,
      offers: mine.length,
      contacted: new Set(mine.map((o) => o.counterpartyId)).size,
      converted: new Set(ordered.map((o) => o.counterpartyId)).size,
      orderedAmount: ordered.reduce((sum, o) => sum + (o.outcomeAmount ?? 0), 0),
      revenueAtRisk,
    };
  });
  reps.sort((a, b) => b.revenueAtRisk - a.revenueAtRisk || a.name.localeCompare(b.name, "uk"));

  // ---- нічийні сплячі ----
  const contacted = new Set(recentlyContacted.map((r) => r.counterpartyId));
  const unownedAll = clients
    .filter(
      (c) =>
        (c.state === "DORMANT" || c.state === "LOST") && c.reps.length === 0 && !contacted.has(c.counterpartyId)
    )
    .map((c) => ({ c, revenue: revenue.get(c.counterpartyId) ?? 0 }))
    .sort((a, b) => b.revenue - a.revenue || a.c.daysSinceLast - b.c.daysSinceLast);
  const top = unownedAll.slice(0, UNOWNED_LIMIT);
  const lastReps = await lastDocReps(top.map((u) => u.c.counterpartyId));

  const unowned = {
    total: unownedAll.length,
    withMobile: unownedAll.filter((u) => hasMobile(u.c.counterpartyId)).length,
    revenue: unownedAll.reduce((sum, u) => sum + u.revenue, 0),
    limit: UNOWNED_LIMIT,
    rows: top.map(
      ({ c, revenue: amount }): UnownedClientRow => ({
        counterpartyId: c.counterpartyId,
        name: c.name,
        state: c.state as "DORMANT" | "LOST",
        hasMobile: hasMobile(c.counterpartyId),
        // Дата 1С — стінний київський час як UTC: день читаємо без перекладу.
        lastDocDay: c.lastDocAt.slice(0, 10),
        daysSinceLast: c.daysSinceLast,
        revenue: amount,
        lastRep: lastReps.get(c.counterpartyId) ?? null,
      })
    ),
  };

  const recent: RecentOutreachRow[] = recentRows.map((r) => ({
    id: r.id,
    sentAt: r.sentAt.toISOString(),
    repName: r.rep?.name ?? null,
    counterpartyId: r.counterpartyId,
    counterpartyName: r.counterparty.name,
    kind: r.kind,
    channel: r.channel,
    purpose: r.purpose,
    outcome: r.outcome,
    outcomeBy: r.outcomeBy,
    outcomeAt: r.outcomeAt?.toISOString() ?? null,
    outcomeAmount: r.outcomeAmount,
  }));

  return {
    period: { fromDay: period.fromDay, toDay: period.toDay, days: period.days, clamped: period.clamped },
    revenueSinceDay: kyivDate(revenueFrom),
    tiles,
    baseline,
    baselineError,
    reps,
    unowned,
    recent,
    salesReps,
  };
}
