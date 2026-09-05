/**
 * Хто заплатив: оплати, рознесені на торгового.
 *
 * Борг у нас падає через регістр 1С, а не через оплату (див. пам'ять
 * проєкту), тож питання «чи прийшли гроші від Кунанця» по сальдо не
 * читається: сальдо просто стане меншим, і коли саме — невідомо.
 * Достовірна відповідь одна — рядки PaymentAllocation: там і сума, і дата,
 * і на кого рознесено.
 *
 * Клієнт береться через рахунок (Payment → Invoice → Counterparty), бо
 * сама алокація знає лише торгового й бренд. Оплата без рахунка можлива —
 * тоді рядок лишається без імені, і вигадувати його ми не будемо.
 */

import { prisma } from "@/lib/prisma";
import type { Period } from "@/lib/analytics/period";

type PaymentRow = {
  counterpartyId: string | null;
  name: string | null;
  amount: number;
  paidAt: Date;
  method: string | null;
};

export type RepPayments = {
  сума: number;
  оплат: number;
  клієнтів: number;
  останні: Array<{
    клієнт_id: string | null;
    назва: string;
    сума: number;
    дата: string;
    спосіб: string | null;
  }>;
  по_клієнтах: Array<{ клієнт_id: string | null; назва: string; сума: number; оплат: number }>;
};

/** Оплати торгового за період: скільки, від кого, коли. */
export async function repPayments(
  repId: string,
  period: Pick<Period, "from" | "to">,
  limit = 12
): Promise<RepPayments> {
  const rows = await prisma.$queryRaw<PaymentRow[]>`
    SELECT
      i."counterpartyId" AS "counterpartyId",
      c.name AS name,
      a.amount::float AS amount,
      COALESCE(p."paidAt", p."createdAt") AS "paidAt",
      p.method AS method
    FROM "PaymentAllocation" a
    JOIN "Payment" p ON p.id = a."paymentId"
    LEFT JOIN "Invoice" i ON i.id = p."invoiceId"
    LEFT JOIN "Counterparty" c ON c.id = i."counterpartyId"
    WHERE a."repId" = ${repId}
      AND COALESCE(p."paidAt", p."createdAt") >= ${period.from}
      AND COALESCE(p."paidAt", p."createdAt") <= ${period.to}
    ORDER BY "paidAt" DESC
  `;

  const byClient = new Map<string, { клієнт_id: string | null; назва: string; сума: number; оплат: number }>();
  for (const r of rows) {
    const key = r.counterpartyId ?? "—";
    const acc = byClient.get(key) ?? {
      клієнт_id: r.counterpartyId,
      назва: r.name ?? "без рахунка",
      сума: 0,
      оплат: 0,
    };
    acc.сума += r.amount;
    acc.оплат += 1;
    byClient.set(key, acc);
  }

  return {
    сума: Math.round(rows.reduce((sum, r) => sum + r.amount, 0)),
    оплат: rows.length,
    клієнтів: byClient.size,
    останні: rows.slice(0, limit).map((r) => ({
      клієнт_id: r.counterpartyId,
      назва: r.name ?? "без рахунка",
      сума: Math.round(r.amount),
      дата: r.paidAt.toISOString().slice(0, 10),
      спосіб: r.method,
    })),
    по_клієнтах: [...byClient.values()]
      .map((c) => ({ ...c, сума: Math.round(c.сума) }))
      .sort((a, b) => b.сума - a.сума),
  };
}

/**
 * Оплати одного клієнта за період — для питання «чи заплатив X».
 *
 * Без фільтра по торговому навмисно: гроші від клієнта могли рознести на
 * колегу (наприклад, накладну виписав інший), а питання «чи заплатив» —
 * про клієнта, не про рознесення.
 */
export async function clientPayments(
  counterpartyId: string,
  period: Pick<Period, "from" | "to">
): Promise<RepPayments["останні"]> {
  const rows = await prisma.$queryRaw<PaymentRow[]>`
    SELECT
      i."counterpartyId" AS "counterpartyId",
      c.name AS name,
      a.amount::float AS amount,
      COALESCE(p."paidAt", p."createdAt") AS "paidAt",
      p.method AS method
    FROM "PaymentAllocation" a
    JOIN "Payment" p ON p.id = a."paymentId"
    JOIN "Invoice" i ON i.id = p."invoiceId"
    LEFT JOIN "Counterparty" c ON c.id = i."counterpartyId"
    WHERE i."counterpartyId" = ${counterpartyId}
      AND COALESCE(p."paidAt", p."createdAt") >= ${period.from}
      AND COALESCE(p."paidAt", p."createdAt") <= ${period.to}
    ORDER BY "paidAt" DESC
    LIMIT 10
  `;

  return rows.map((r) => ({
    клієнт_id: r.counterpartyId,
    назва: r.name ?? "без рахунка",
    сума: Math.round(r.amount),
    дата: r.paidAt.toISOString().slice(0, 10),
    спосіб: r.method,
  }));
}
