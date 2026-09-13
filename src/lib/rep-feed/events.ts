/**
 * Детектори подій стрічки торгового.
 *
 * Кожен читає своє джерело «з моменту since» і повертає готові події з
 * ключем дедуплікації. Ніхто тут нічого не пише — запис і рішення про пуш
 * робить notify.ts. У 1С не пишеться нічого й ніколи.
 *
 * Дві межі часу, і вони різні за природою:
 * - `since` — курсор по НАШИХ мітках (createdAt рознесення, updatedAt
 *   документа, updatedAt позначки складу, deliveredAt точки): «що ми
 *   дізналися з минулого тіку»;
 * - `docFloor` — межа по ДАТІ 1С (paidAt, confirmedAt, createdAt документа):
 *   «і чи це взагалі новина». Нічний повний прогін і ковзне вікно обміну
 *   переписують документи триденної давнини, бекфіл рознесення створює
 *   рядки для торішніх оплат — усе це має мітку «щойно», але не є подією.
 *
 * Модуль не імпортує нічого з next/*: він збирається у воркер (CLAUDE.md).
 */

import { prisma } from "@/lib/prisma";
import { pickLines, pickProgress } from "@/lib/warehouse/picking";
import { describe } from "./format";
import { REP_FEED_TYPES, type FeedEvent } from "./types";

/**
 * Чий це клієнт — а отже, кому пуш.
 *
 * Не «Ответственный» документа: у 1С його часто ставить на себе офіс, який
 * набирає замовлення за польового торгового (див. field-sales-reps-vs-office).
 * Тоді польовий не дізнався б про власного клієнта, а офісна обліковка
 * отримувала б чуже. Драбина: закріплення клієнта (SalesRepClient, перше за
 * id — так само, як у рознесенні оплат) → відповідальний документа. Обидва
 * мусять бути торговими; інакше події немає.
 */
async function resolveReps(
  rows: { counterpartyId: string | null; salesRepId: string | null }[]
): Promise<(row: { counterpartyId: string | null; salesRepId: string | null }) => string | null> {
  const cpIds = [...new Set(rows.map((r) => r.counterpartyId).filter((id): id is string => !!id))];
  const assigned = cpIds.length
    ? await prisma.salesRepClient.findMany({
        where: { counterpartyId: { in: cpIds } },
        select: { counterpartyId: true, salesRepId: true },
        orderBy: { id: "asc" },
      })
    : [];
  const firstByClient = new Map<string, string>();
  for (const a of assigned) if (!firstByClient.has(a.counterpartyId)) firstByClient.set(a.counterpartyId, a.salesRepId);

  const candidates = new Set<string>([...firstByClient.values()]);
  for (const r of rows) if (r.salesRepId) candidates.add(r.salesRepId);
  const sales = new Set(
    candidates.size
      ? (
          await prisma.user.findMany({
            where: { id: { in: [...candidates] }, role: "SALES" },
            select: { id: true },
          })
        ).map((u) => u.id)
      : []
  );

  return (row) => {
    const byClient = row.counterpartyId ? firstByClient.get(row.counterpartyId) : undefined;
    if (byClient && sales.has(byClient)) return byClient;
    if (row.salesRepId && sales.has(row.salesRepId)) return row.salesRepId;
    return null;
  };
}

/**
 * Проведена накладна, яка вже могла піти далі. `liveOnSite && posted`
 * лишає складський статус (PACKING, IN_TRANSIT), тож «проведено» — це
 * будь-який статус після DRAFT, крім скасування.
 */
const POSTED_STATUSES = ["CONFIRMED", "PACKING", "IN_TRANSIT", "DELIVERED"] as const;

const docSelect = {
  id: true,
  number: true,
  totalAmount: true,
  salesRepId: true,
  counterpartyId: true,
  counterparty: { select: { name: true } },
} as const;

async function payments(since: Date, docFloor: Date): Promise<FeedEvent[]> {
  const rows = await prisma.paymentAllocation.findMany({
    where: {
      createdAt: { gt: since },
      payment: {
        OR: [{ paidAt: { gte: docFloor } }, { paidAt: null, createdAt: { gte: docFloor } }],
      },
    },
    select: {
      id: true,
      repId: true,
      createdAt: true,
      payment: {
        select: {
          amount: true,
          invoice: {
            select: {
              counterpartyId: true,
              counterparty: { select: { name: true, receivableBalance: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const repFor = await resolveReps(
    rows.map((r) => ({ counterpartyId: r.payment.invoice.counterpartyId, salesRepId: r.repId }))
  );

  const events: FeedEvent[] = [];
  for (const r of rows) {
    const repId = repFor({ counterpartyId: r.payment.invoice.counterpartyId, salesRepId: r.repId });
    if (!repId) continue;
    const cp = r.payment.invoice.counterparty;
    const text = describe({
      type: REP_FEED_TYPES.PAYMENT,
      name: cp.name,
      amount: r.payment.amount,
      balance: cp.receivableBalance ?? null,
    });
    events.push({
      type: REP_FEED_TYPES.PAYMENT,
      repId,
      // Ключ по рознесенню, не по платежу: один платіж може бути рознесений
      // на двох торгових, і кожен має отримати свій рядок.
      dedupKey: `${REP_FEED_TYPES.PAYMENT}:${r.id}`,
      relatedId: r.payment.invoice.counterpartyId,
      target: `/sales/clients/${r.payment.invoice.counterpartyId}`,
      ...text,
      at: r.createdAt,
    });
  }
  return events;
}

async function posted(since: Date, docFloor: Date): Promise<FeedEvent[]> {
  const docs = await prisma.salesDocument.findMany({
    where: {
      docType: "REALIZATION",
      status: { in: [...POSTED_STATUSES] },
      updatedAt: { gt: since },
      confirmedAt: { gte: docFloor },
      // Лише документи з 1С: створені на сайті мають свої сповіщення
      // (SALES_DOC_CONFIRMED керівникам) і на торгового не йдуть.
      externalId: { not: null },
    },
    select: { ...docSelect, updatedAt: true },
    orderBy: { updatedAt: "asc" },
  });
  const repFor = await resolveReps(docs);

  return docs.flatMap((d) => {
    const repId = repFor(d);
    if (!repId) return [];
    return [{
    type: REP_FEED_TYPES.DOC_POSTED,
    repId,
    dedupKey: `${REP_FEED_TYPES.DOC_POSTED}:${d.id}`,
    relatedId: d.id,
    target: `/sales/orders/${d.id}`,
    ...describe({
      type: REP_FEED_TYPES.DOC_POSTED,
      name: d.counterparty?.name,
      number: d.number,
      amount: d.totalAmount,
    }),
    at: d.updatedAt,
    } satisfies FeedEvent];
  });
}

async function picked(since: Date, docFloor: Date): Promise<FeedEvent[]> {
  const touched = await prisma.pickMark.findMany({
    where: { updatedAt: { gt: since } },
    select: { salesDocumentId: true, updatedAt: true },
    orderBy: { updatedAt: "asc" },
  });
  if (touched.length === 0) return [];

  const lastMark = new Map<string, Date>();
  for (const m of touched) lastMark.set(m.salesDocumentId, m.updatedAt);

  const docs = await prisma.salesDocument.findMany({
    where: {
      id: { in: [...lastMark.keys()] },
      docType: "REALIZATION",
      status: { not: "CANCELLED" },
      createdAt: { gte: docFloor },
    },
    select: docSelect,
  });
  const repFor = await resolveReps(docs);

  const events: FeedEvent[] = [];
  for (const d of docs) {
    const repId = repFor(d);
    if (!repId) continue;
    // Той самий підрахунок, що на екрані складу: зібрано = ні недобору, ні
    // зайвого. Інакше пуш казав би «зібрано» там, де екран ще показує рядки.
    const progress = pickProgress(await pickLines(d.id));
    if (!progress.готово || progress.позицій === 0) continue;
    events.push({
      type: REP_FEED_TYPES.DOC_PICKED,
      repId,
      dedupKey: `${REP_FEED_TYPES.DOC_PICKED}:${d.id}`,
      relatedId: d.id,
      target: `/sales/orders/${d.id}`,
      ...describe({
        type: REP_FEED_TYPES.DOC_PICKED,
        name: d.counterparty?.name,
        number: d.number,
        amount: d.totalAmount,
        lines: progress.позицій,
      }),
      at: lastMark.get(d.id) ?? new Date(),
    });
  }
  return events;
}

async function returns(since: Date, docFloor: Date): Promise<FeedEvent[]> {
  const docs = await prisma.salesDocument.findMany({
    where: {
      docType: "RETURN",
      status: "CONFIRMED",
      updatedAt: { gt: since },
      createdAt: { gte: docFloor },
      externalId: { not: null },
    },
    select: { ...docSelect, updatedAt: true },
    orderBy: { updatedAt: "asc" },
  });
  const repFor = await resolveReps(docs);

  return docs.flatMap((d) => {
    const repId = repFor(d);
    if (!repId) return [];
    return [{
    type: REP_FEED_TYPES.RETURN,
    repId,
    dedupKey: `${REP_FEED_TYPES.RETURN}:${d.id}`,
    relatedId: d.id,
    target: `/sales/orders/${d.id}`,
    ...describe({
      type: REP_FEED_TYPES.RETURN,
      name: d.counterparty?.name,
      number: d.number,
      amount: d.totalAmount,
    }),
    at: d.updatedAt,
    } satisfies FeedEvent];
  });
}

/**
 * Доставку водій відмічає в реальному часі, тож межі по даті документа
 * тут немає: накладну з п'ятниці везуть у понеділок, і це все одно новина.
 */
async function delivered(since: Date): Promise<FeedEvent[]> {
  const stops = await prisma.deliveryStop.findMany({
    where: {
      deliveredAt: { gt: since },
      salesDocumentId: { not: null },
    },
    select: { deliveredAt: true, salesDocument: { select: docSelect } },
    orderBy: { deliveredAt: "asc" },
  });
  const repFor = await resolveReps(stops.flatMap((s) => (s.salesDocument ? [s.salesDocument] : [])));

  const events: FeedEvent[] = [];
  for (const s of stops) {
    const d = s.salesDocument;
    if (!d || !s.deliveredAt) continue;
    const repId = repFor(d);
    if (!repId) continue;
    events.push({
      type: REP_FEED_TYPES.DOC_DELIVERED,
      repId,
      dedupKey: `${REP_FEED_TYPES.DOC_DELIVERED}:${d.id}`,
      relatedId: d.id,
      target: `/sales/orders/${d.id}`,
      ...describe({
        type: REP_FEED_TYPES.DOC_DELIVERED,
        name: d.counterparty?.name,
        number: d.number,
        amount: d.totalAmount,
      }),
      at: s.deliveredAt,
    });
  }
  return events;
}

/** Усі події з моменту `since`, у порядку часу. */
export async function collectEvents(since: Date, docFloor: Date): Promise<FeedEvent[]> {
  const parts = await Promise.all([
    payments(since, docFloor),
    posted(since, docFloor),
    picked(since, docFloor),
    returns(since, docFloor),
    delivered(since),
  ]);
  return parts.flat().sort((a, b) => a.at.getTime() - b.at.getTime());
}
