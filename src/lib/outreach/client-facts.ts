/**
 * Що треба знати про клієнта, перш ніж йому писати.
 *
 * Картка клієнта вже показує борг і документи, але пропозиції потрібен інший
 * зріз: як до людини звертатися, чи є куди написати (мобільний, а не міський),
 * чи не просив він не турбувати, і коли йому писали востаннє — кожне з цього
 * міняє або текст, або саме рішення писати.
 *
 * Стан і ритм не рахуються тут наново: clientStatesNow — та сама класифікація,
 * що на карті й у помічнику. Прострочка — agingByCounterparty, як у списку
 * клієнтів. Два екрани з різними «спить» про одну людину — гірше, ніж жоден.
 */

import { prisma } from "@/lib/prisma";
import type { ClientState } from "@/lib/analytics/clients";
import { agingByCounterparty, type CounterpartyAging } from "@/lib/analytics/money-facts";
import { myClientsCte } from "@/lib/assistant/facts/sql";
import { clientStatesNow, type ClientStateFacts } from "@/lib/assistant/facts/client-state";
import { isInternalClient, loadInternalContext } from "@/lib/rep-feed/internal";
import { displayClientName, greetingFor, greetingName } from "./templates";
import {
  MARKETING_CAP,
  QUIET_AFTER_OUTREACH_DAYS,
  isMarketingConsent,
  outreachPhone,
  refusesMessages,
  type MarketingConsent,
} from "./types";

export { displayClientName } from "./templates";

const DAY_MS = 86_400_000;

export type LastOutreach = {
  at: string;
  daysAgo: number;
  kind: string;
  channel: string;
  outcome: string;
  repId: string | null;
  repName: string | null;
};

export type ClientOutreachFacts = {
  id: string;
  name: string;
  displayName: string;
  code: string | null;
  contactPerson: string | null;
  address: string | null;
  greetingName: string | null;
  greeting: string;
  phone: { raw: string | null; e164: string | null };
  state: ClientState | null;
  daysSinceLast: number | null;
  avgIntervalDays: number;
  lastDocAt: string | null;
  receivable: number;
  overdue: number;
  marketingConsent: MarketingConsent;
  marketingConsentAt: string | null;
  marketingOptOutAt: string | null;
  preferredChannel: string | null;
  isInternal: boolean;
  lastOutreach: LastOutreach | null;
  /** Рекламних повідомлень за MARKETING_CAP.days — дзвінки не рахуються. */
  marketingRecent: number;
  capReached: boolean;
};

/** Поля контрагента, з яких складаються факти. Нові поля необов'язкові — див. buildOutreachFacts. */
export type OutreachCounterpartyRow = {
  id: string;
  name: string;
  code: string | null;
  contactPerson: string | null;
  address: string | null;
  phone: string | null;
  receivableBalance: number | null;
  primaryPhoneE164?: string | null;
  marketingConsent?: string | null;
  marketingConsentAt?: Date | null;
  marketingOptOutAt?: Date | null;
  preferredChannel?: string | null;
};

export type OutreachStats = { last: LastOutreach | null; marketingRecent: number };

/**
 * Чиста збірка фактів із уже завантажених шматків.
 *
 * Окремо від завантаження, щоб scripts/outreach-dry.mts міг скласти ті самі
 * факти з бойової бази до міграції: там немає нових колонок і таблиці
 * ClientOutreach, але стан, борг і звертання рахуються однаково.
 */
export function buildOutreachFacts(input: {
  row: OutreachCounterpartyRow;
  state: ClientStateFacts | undefined;
  aging: CounterpartyAging | undefined;
  internal: boolean;
  stats: OutreachStats | undefined;
}): ClientOutreachFacts {
  const { row, state, aging, internal, stats } = input;
  const name = greetingName(row.contactPerson, row.name);
  const marketingRecent = stats?.marketingRecent ?? 0;
  return {
    id: row.id,
    name: row.name,
    displayName: displayClientName(row.name),
    code: row.code,
    contactPerson: row.contactPerson,
    address: row.address,
    greetingName: name,
    greeting: greetingFor(name),
    phone: { raw: row.phone, e164: outreachPhone(row) },
    state: state?.state ?? null,
    daysSinceLast: state?.daysSinceLast ?? null,
    avgIntervalDays: Math.round(state?.avgIntervalDays ?? 0),
    lastDocAt: state?.lastDocAt?.toISOString() ?? null,
    // Сальдо 1С, а не aging.debt: aging бачить лише клієнтів із боргом > 0,
    // а переплата (мінус) — теж відповідь на «чи є борг».
    receivable: Math.max(0, row.receivableBalance ?? 0),
    overdue: Math.round((aging?.overdue ?? 0) * 100) / 100,
    marketingConsent: isMarketingConsent(row.marketingConsent) ? row.marketingConsent : "UNKNOWN",
    marketingConsentAt: row.marketingConsentAt?.toISOString() ?? null,
    marketingOptOutAt: row.marketingOptOutAt?.toISOString() ?? null,
    preferredChannel: row.preferredChannel ?? null,
    isInternal: internal,
    lastOutreach: stats?.last ?? null,
    marketingRecent,
    capReached: marketingRecent >= MARKETING_CAP.max,
  };
}

/**
 * Остання пропозиція й кількість рекламних за вікно стелі — одним запитом на
 * будь-яку кількість клієнтів.
 *
 * Дзвінок і розмова особисто в стелю не йдуть: стеля захищає від спаму в
 * месенджері, а живу розмову клієнт спамом не вважає.
 */
export async function outreachStats(counterpartyIds: string[], now: Date = new Date()): Promise<Map<string, OutreachStats>> {
  const out = new Map<string, OutreachStats>();
  const ids = [...new Set(counterpartyIds)];
  if (ids.length === 0) return out;

  const capSince = new Date(now.getTime() - MARKETING_CAP.days * DAY_MS);
  const rows = await prisma.$queryRaw<
    Array<{
      counterpartyId: string;
      sentAt: Date;
      kind: string;
      channel: string;
      outcome: string;
      repId: string | null;
      repName: string | null;
      marketingRecent: number;
    }>
  >`
    SELECT DISTINCT ON (o."counterpartyId")
      o."counterpartyId", o."sentAt", o.kind, o.channel, o.outcome, o."repId", u.name AS "repName",
      (COUNT(*) FILTER (
        WHERE o.purpose = 'MARKETING'
          AND o.channel NOT IN ('CALL', 'IN_PERSON')
          AND o."sentAt" >= ${capSince}
      ) OVER (PARTITION BY o."counterpartyId"))::int AS "marketingRecent"
    FROM "ClientOutreach" o
    LEFT JOIN "User" u ON u.id = o."repId"
    WHERE o."counterpartyId" = ANY(${ids}::text[])
    ORDER BY o."counterpartyId", o."sentAt" DESC
  `;

  for (const r of rows) {
    out.set(r.counterpartyId, {
      last: {
        at: r.sentAt.toISOString(),
        daysAgo: Math.max(0, Math.floor((now.getTime() - r.sentAt.getTime()) / DAY_MS)),
        kind: r.kind,
        channel: r.channel,
        outcome: r.outcome,
        repId: r.repId,
        repName: r.repName?.trim() || null,
      },
      marketingRecent: r.marketingRecent,
    });
  }
  return out;
}

export async function clientOutreachFacts(
  counterpartyId: string,
  now: Date = new Date()
): Promise<ClientOutreachFacts | null> {
  const row = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: {
      id: true,
      name: true,
      code: true,
      contactPerson: true,
      address: true,
      phone: true,
      receivableBalance: true,
      primaryPhoneE164: true,
      marketingConsent: true,
      marketingConsentAt: true,
      marketingOptOutAt: true,
      preferredChannel: true,
    },
  });
  if (!row) return null;

  const [states, aging, internalCtx, stats] = await Promise.all([
    clientStatesNow([counterpartyId], now),
    agingByCounterparty([counterpartyId], now),
    loadInternalContext(),
    outreachStats([counterpartyId], now),
  ]);

  return buildOutreachFacts({
    row,
    state: states.get(counterpartyId),
    aging: aging.get(counterpartyId),
    internal: isInternalClient(row, internalCtx),
    stats: stats.get(counterpartyId),
  });
}

/* ---------- Список клієнтів торгового ---------- */

export const CLIENT_FILTERS = ["all", "slipping", "dormant", "lost", "no_outreach"] as const;
export type ClientFilter = (typeof CLIENT_FILTERS)[number];

export const isClientFilter = (v: unknown): v is ClientFilter =>
  typeof v === "string" && (CLIENT_FILTERS as readonly string[]).includes(v);

export type OutreachClientItem = {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
  phoneE164: string | null;
  address: string | null;
  receivable: number;
  overdue: number;
  lastDocAt: string | null;
  daysSinceLast: number | null;
  state: ClientState | null;
  avgIntervalDays: number;
  lastOutreach: { at: string; channel: string; outcome: string } | null;
  /** Просив не писати — refusesMessages() з types.ts. */
  refusesMessages: boolean;
};

export type OutreachClientList = {
  items: OutreachClientItem[];
  counts: Record<ClientFilter, number>;
};

/** Без пропозиції за QUIET_AFTER_OUTREACH_DAYS — фільтр і тижневий пуш. */
export function isQuiet(item: Pick<OutreachClientItem, "lastOutreach">, now: Date): boolean {
  if (!item.lastOutreach) return true;
  return now.getTime() - new Date(item.lastOutreach.at).getTime() >= QUIET_AFTER_OUTREACH_DAYS * DAY_MS;
}

function matches(item: OutreachClientItem, filter: ClientFilter, now: Date): boolean {
  switch (filter) {
    case "all":
      return true;
    case "slipping":
      return item.state === "SLIPPING";
    case "dormant":
      return item.state === "DORMANT";
    case "lost":
      return item.state === "LOST";
    case "no_outreach":
      return isQuiet(item, now);
  }
}

/**
 * Клієнти торгового для списку «давно не брав».
 *
 * «Мої» — тим самим myClientsCte, що й /api/erp/counterparties?mine=1 і
 * помічник: закріплення плюс документи з цим торговим. Тип — лише покупці,
 * як і в старому списку: постачальник у «сплячих» — не робота торгового.
 */
export async function listOutreachClients(
  repId: string,
  filter: ClientFilter,
  now: Date = new Date()
): Promise<OutreachClientList> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      name: string;
      code: string | null;
      phone: string | null;
      primaryPhoneE164: string | null;
      address: string | null;
      receivable: number | null;
      marketingOptOutAt: Date | null;
      marketingConsent: string | null;
      preferredChannel: string | null;
    }>
  >`
    WITH ${myClientsCte(repId)}
    SELECT c.id, c.name, c.code, c.phone, c."primaryPhoneE164", c.address,
           c."receivableBalance"::float AS receivable,
           c."marketingOptOutAt", c."marketingConsent", c."preferredChannel"
    FROM "Counterparty" c
    WHERE c.id IN (SELECT id FROM my_clients)
      AND c.type IN ('CUSTOMER', 'BOTH')
  `;

  const internalCtx = await loadInternalContext();
  const clients = rows.filter((r) => !isInternalClient(r, internalCtx));
  const ids = clients.map((c) => c.id);

  const [states, aging, stats] = await Promise.all([
    clientStatesNow(ids, now),
    agingByCounterparty(ids, now),
    outreachStats(ids, now),
  ]);

  const all: OutreachClientItem[] = clients.map((c) => {
    const st = states.get(c.id);
    const last = stats.get(c.id)?.last ?? null;
    return {
      id: c.id,
      name: c.name,
      code: c.code,
      phone: c.phone,
      phoneE164: outreachPhone(c),
      address: c.address,
      receivable: Math.max(0, c.receivable ?? 0),
      overdue: Math.round(aging.get(c.id)?.overdue ?? 0),
      lastDocAt: st?.lastDocAt?.toISOString() ?? null,
      daysSinceLast: st?.daysSinceLast ?? null,
      state: st?.state ?? null,
      avgIntervalDays: Math.round(st?.avgIntervalDays ?? 0),
      lastOutreach: last ? { at: last.at, channel: last.channel, outcome: last.outcome } : null,
      refusesMessages: refusesMessages(c),
    };
  });

  const counts = Object.fromEntries(
    CLIENT_FILTERS.map((f) => [f, all.filter((i) => matches(i, f, now)).length])
  ) as Record<ClientFilter, number>;

  const byName = (a: OutreachClientItem, b: OutreachClientItem) => a.name.localeCompare(b.name, "uk");
  const items = all.filter((i) => matches(i, filter, now));
  // «Усі» — за абеткою, як звик торговий. Решта — хто довше мовчить, той
  // вище: саме це питання фільтр і ставить. Без покупок — у кінець.
  items.sort(
    filter === "all"
      ? byName
      : (a, b) => (b.daysSinceLast ?? -1) - (a.daysSinceLast ?? -1) || byName(a, b)
  );

  return { items, counts };
}
