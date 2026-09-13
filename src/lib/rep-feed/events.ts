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

/** Лише торгові: офісні імена з «Ответственный» 1С теж мають salesRepId. */
const SALES_REP = { role: "SALES" as const };

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
  counterparty: { select: { name: true } },
} as const;

async function payments(since: Date, docFloor: Date): Promise<FeedEvent[]> {
  const rows = await prisma.paymentAllocation.findMany({
    where: {
      createdAt: { gt: since },
      rep: SALES_REP,
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

  return rows.map((r) => {
    const cp = r.payment.invoice.counterparty;
    const text = describe({
      type: REP_FEED_TYPES.PAYMENT,
      name: cp.name,
      amount: r.payment.amount,
      balance: cp.receivableBalance ?? null,
    });
    return {
      type: REP_FEED_TYPES.PAYMENT,
      repId: r.repId,
      // Ключ по рознесенню, не по платежу: один платіж може бути рознесений
      // на двох торгових, і кожен має отримати свій рядок.
      dedupKey: `${REP_FEED_TYPES.PAYMENT}:${r.id}`,
      relatedId: r.payment.invoice.counterpartyId,
      target: `/sales/clients/${r.payment.invoice.counterpartyId}`,
      ...text,
      at: r.createdAt,
    };
  });
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
      salesRepId: { not: null },
      salesRep: SALES_REP,
    },
    select: { ...docSelect, updatedAt: true },
    orderBy: { updatedAt: "asc" },
  });

  return docs.map((d) => ({
    type: REP_FEED_TYPES.DOC_POSTED,
    repId: d.salesRepId as string,
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
  }));
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
      salesRepId: { not: null },
      salesRep: SALES_REP,
    },
    select: docSelect,
  });

  const events: FeedEvent[] = [];
  for (const d of docs) {
    // Той самий підрахунок, що на екрані складу: зібрано = ні недобору, ні
    // зайвого. Інакше пуш казав би «зібрано» там, де екран ще показує рядки.
    const progress = pickProgress(await pickLines(d.id));
    if (!progress.готово || progress.позицій === 0) continue;
    events.push({
      type: REP_FEED_TYPES.DOC_PICKED,
      repId: d.salesRepId as string,
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
      salesRepId: { not: null },
      salesRep: SALES_REP,
    },
    select: { ...docSelect, updatedAt: true },
    orderBy: { updatedAt: "asc" },
  });

  return docs.map((d) => ({
    type: REP_FEED_TYPES.RETURN,
    repId: d.salesRepId as string,
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
  }));
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
      salesDocument: { salesRepId: { not: null }, salesRep: SALES_REP },
    },
    select: { deliveredAt: true, salesDocument: { select: docSelect } },
    orderBy: { deliveredAt: "asc" },
  });

  const events: FeedEvent[] = [];
  for (const s of stops) {
    const d = s.salesDocument;
    if (!d || !d.salesRepId || !s.deliveredAt) continue;
    events.push({
      type: REP_FEED_TYPES.DOC_DELIVERED,
      repId: d.salesRepId,
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
