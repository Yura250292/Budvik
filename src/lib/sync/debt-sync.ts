import { prisma } from "@/lib/prisma";
import { parseCSVLine } from "./utils";

export interface ParsedDebtRecord {
  counterpartyCode: string;
  counterpartyName: string;
  totalDebt: number; // загальна дебіторка в 1С
  paidAmount?: number;
}

export interface DebtSyncPreviewItem {
  counterpartyCode: string;
  counterpartyName: string;
  debt1C: number;
  debtBudvik: number;
  difference: number;
  action: "matched" | "mismatch" | "only_in_1c" | "only_in_budvik";
}

export interface DebtSyncPreviewResult {
  total: number;
  matched: number;
  mismatched: number;
  onlyIn1C: number;
  totalDebt1C: number;
  totalDebtBudvik: number;
  items: DebtSyncPreviewItem[];
}

/** Parse debt CSV from 1C
 * Expected columns: код/code, назва/name, борг/debt/дебіторка/заборгованість, оплачено/paid
 */
export function parseDebtCSV(csv: string): ParsedDebtRecord[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const sep = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"(.*)"$/, "$1").toLowerCase());

  const codeIdx = headers.findIndex((h) =>
    ["код", "code", "єдрпоу", "едрпоу", "id", "ід"].includes(h)
  );
  const nameIdx = headers.findIndex((h) =>
    ["назва", "наименование", "найменування", "name", "контрагент", "counterparty"].includes(h)
  );
  const debtIdx = headers.findIndex((h) =>
    ["борг", "debt", "дебіторка", "дебиторка", "заборгованість", "задолженность", "залишок_боргу", "сума_боргу", "balance"].includes(h)
  );
  const paidIdx = headers.findIndex((h) =>
    ["оплачено", "paid", "сплачено", "оплата"].includes(h)
  );

  if (nameIdx === -1) return [];

  const records: ParsedDebtRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCSVLine(line, sep);

    const name = cols[nameIdx]?.trim().replace(/^"(.*)"$/, "$1");
    if (!name || name.length < 3) continue;

    const code = codeIdx >= 0 ? cols[codeIdx]?.trim().replace(/^"(.*)"$/, "$1") : "";
    const debt = debtIdx >= 0
      ? parseFloat(cols[debtIdx]?.replace(",", ".").replace(/\s/g, "")) || 0
      : 0;
    const paid = paidIdx >= 0
      ? parseFloat(cols[paidIdx]?.replace(",", ".").replace(/\s/g, "")) || 0
      : undefined;

    records.push({
      counterpartyCode: code || name,
      counterpartyName: name,
      totalDebt: Math.round(debt * 100) / 100,
      paidAmount: paid !== undefined ? Math.round(paid * 100) / 100 : undefined,
    });
  }

  return records;
}

/** Preview debt comparison — compare 1C debts with Budvik invoices */
export async function previewDebtSync(
  parsed: ParsedDebtRecord[]
): Promise<DebtSyncPreviewResult> {
  const items: DebtSyncPreviewItem[] = [];
  let matched = 0;
  let mismatched = 0;
  let onlyIn1C = 0;
  let totalDebt1C = 0;
  let totalDebtBudvik = 0;

  for (const record of parsed) {
    totalDebt1C += record.totalDebt;

    // Find counterparty in Budvik
    const cp = await prisma.counterparty.findFirst({
      where: {
        OR: [
          { code: record.counterpartyCode },
          { name: record.counterpartyName },
        ],
      },
    });

    if (!cp) {
      onlyIn1C++;
      items.push({
        counterpartyCode: record.counterpartyCode,
        counterpartyName: record.counterpartyName,
        debt1C: record.totalDebt,
        debtBudvik: 0,
        difference: record.totalDebt,
        action: "only_in_1c",
      });
      continue;
    }

    // Calculate Budvik debt from unpaid invoices
    const invoices = await prisma.invoice.findMany({
      where: {
        counterpartyId: cp.id,
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
      },
    });

    const debtBudvik = invoices.reduce((sum, inv) => sum + (inv.totalAmount - inv.paidAmount), 0);
    totalDebtBudvik += debtBudvik;

    const difference = Math.round((record.totalDebt - debtBudvik) * 100) / 100;

    if (Math.abs(difference) <= 1) {
      matched++;
      items.push({
        counterpartyCode: record.counterpartyCode,
        counterpartyName: record.counterpartyName,
        debt1C: record.totalDebt,
        debtBudvik: Math.round(debtBudvik * 100) / 100,
        difference: 0,
        action: "matched",
      });
    } else {
      mismatched++;
      items.push({
        counterpartyCode: record.counterpartyCode,
        counterpartyName: record.counterpartyName,
        debt1C: record.totalDebt,
        debtBudvik: Math.round(debtBudvik * 100) / 100,
        difference,
        action: "mismatch",
      });
    }
  }

  return {
    total: parsed.length,
    matched,
    mismatched,
    onlyIn1C,
    totalDebt1C: Math.round(totalDebt1C * 100) / 100,
    totalDebtBudvik: Math.round(totalDebtBudvik * 100) / 100,
    items,
  };
}

/** Apply debt sync — only records discrepancies, does NOT create invoices */
export async function applyDebtSync(
  parsed: ParsedDebtRecord[],
  fileName: string
) {
  const syncJob = await prisma.syncJob.create({
    data: {
      type: "debt",
      status: "running",
      fileName,
      recordsTotal: parsed.length,
    },
  });

  let matched = 0;
  let mismatched = 0;
  let onlyIn1C = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const record of parsed) {
    try {
      const cp = await prisma.counterparty.findFirst({
        where: {
          OR: [
            { code: record.counterpartyCode },
            { name: record.counterpartyName },
          ],
        },
      });

      if (!cp) {
        await prisma.syncDiscrepancy.create({
          data: {
            syncJobId: syncJob.id,
            entityType: "debt",
            entityRef: record.counterpartyCode,
            entityName: record.counterpartyName,
            field: "only_in_1c",
            value1C: `${record.totalDebt} грн`,
            valueBudvik: "контрагент не знайдений",
          },
        });
        onlyIn1C++;
        continue;
      }

      const invoices = await prisma.invoice.findMany({
        where: {
          counterpartyId: cp.id,
          paymentStatus: { in: ["UNPAID", "PARTIAL"] },
        },
      });

      const debtBudvik = invoices.reduce((sum, inv) => sum + (inv.totalAmount - inv.paidAmount), 0);
      const difference = Math.round((record.totalDebt - debtBudvik) * 100) / 100;

      if (Math.abs(difference) <= 1) {
        matched++;
      } else {
        await prisma.syncDiscrepancy.create({
          data: {
            syncJobId: syncJob.id,
            entityType: "debt",
            entityRef: cp.code || record.counterpartyCode,
            entityName: record.counterpartyName,
            field: "debt_amount",
            value1C: `${record.totalDebt} грн`,
            valueBudvik: `${Math.round(debtBudvik * 100) / 100} грн`,
          },
        });
        mismatched++;
      }
    } catch (e: any) {
      errors.push(`${record.counterpartyName}: ${e.message}`);
      failed++;
    }
  }

  await prisma.syncJob.update({
    where: { id: syncJob.id },
    data: {
      status: "completed",
      recordsCreated: 0,
      recordsUpdated: mismatched,
      recordsSkipped: matched,
      recordsFailed: failed + onlyIn1C,
      errors: errors.length > 0 ? JSON.stringify(errors.slice(0, 50)) : null,
      completedAt: new Date(),
    },
  });

  return {
    syncJobId: syncJob.id,
    total: parsed.length,
    matched,
    mismatched,
    onlyIn1C,
    failed,
    errors: errors.slice(0, 30),
    discrepancies: mismatched + onlyIn1C,
  };
}
