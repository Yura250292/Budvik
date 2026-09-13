/**
 * Виписка по клієнту з бази: документи 1С, ПКО і сальдо регістра.
 * Збірка й пояснення цифр — statement-build.ts.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate } from "@/lib/date/kyiv";
import { buildStatement, docNo, paymentLabel, type StatementEntry, type StatementResult } from "./statement-build";

export const STATEMENT_DAYS = [30, 60, 90] as const;
const DAY_MS = 24 * 60 * 60_000;

export type StatementPayload = {
  client: { id: string; name: string; code: string | null };
  fromDay: string;
  toDay: string;
  balanceSyncedAt: string | null;
  result: Omit<StatementResult, "rows"> & {
    rows: (Omit<StatementResult["rows"][number], "at"> & { at: string })[];
  };
};

export async function loadStatement(
  counterpartyId: string,
  days: number,
  now = new Date()
): Promise<StatementPayload | null> {
  const cp = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: { id: true, name: true, code: true, receivableBalance: true, balanceSyncedAt: true },
  });
  if (!cp) return null;

  const toDay = kyivDate(now);
  const fromDay = kyivDate(new Date(now.getTime() - (days - 1) * DAY_MS));
  // Дати документів і ПКО з 1С — стінний київський час, записаний як UTC.
  const from = new Date(`${fromDay}T00:00:00.000Z`);

  const [docs, payments] = await Promise.all([
    prisma.salesDocument.findMany({
      where: {
        counterpartyId,
        externalId: { not: null },
        status: "CONFIRMED",
        docType: { in: ["REALIZATION", "RETURN"] },
        createdAt: { gte: from },
      },
      select: { id: true, number: true, docType: true, totalAmount: true, createdAt: true },
    }),
    prisma.payment.findMany({
      where: {
        invoice: { counterpartyId },
        OR: [{ paidAt: { gte: from } }, { paidAt: null, createdAt: { gte: from } }],
      },
      select: { id: true, amount: true, notes: true, paidAt: true, createdAt: true },
    }),
  ]);

  const entries: StatementEntry[] = [
    ...docs.map((d) => ({
      at: d.createdAt,
      kind: d.docType === "RETURN" ? ("RETURN" as const) : ("SALE" as const),
      label: `${d.docType === "RETURN" ? "Повернення" : "Реалізація"} №${docNo(d.number)}`,
      // Суми повернень у базі вже від'ємні — це і є їхній вплив на борг.
      amount: d.totalAmount,
      docId: d.id,
    })),
    ...payments.map((p) => ({
      at: p.paidAt ?? p.createdAt,
      kind: "PAYMENT" as const,
      label: paymentLabel(p.notes),
      amount: -p.amount,
    })),
  ];

  const result = buildStatement(entries, cp.receivableBalance ?? 0);
  return {
    client: { id: cp.id, name: cp.name, code: cp.code },
    fromDay,
    toDay,
    balanceSyncedAt: cp.balanceSyncedAt?.toISOString() ?? null,
    result: { ...result, rows: result.rows.map((r) => ({ ...r, at: r.at.toISOString() })) },
  };
}
