import { prisma } from "@/lib/prisma";
import { parseSalesDocumentsCSV, parseSalesDocumentsXML, type ParsedSalesDocumentImport } from "@/lib/import-1c";

export interface SalesDocSyncPreviewItem {
  number: string;
  date: string;
  customer: string;
  itemCount: number;
  total1C: number;
  totalBudvik?: number;
  action: "create" | "mismatch" | "matched";
  mismatches?: { field: string; from: string; to: string }[];
}

export interface SalesDocSyncPreviewResult {
  total: number;
  matched: number;
  mismatched: number;
  missing: number;
  items: SalesDocSyncPreviewItem[];
}

/** Parse file content into sales documents */
export function parseFileToSalesDocs(content: string, fileName: string): ParsedSalesDocumentImport[] {
  const ext = fileName.toLowerCase();
  if (ext.endsWith(".xml")) return parseSalesDocumentsXML(content);
  return parseSalesDocumentsCSV(content);
}

/** Preview sales document sync — read-only comparison */
export async function previewSalesDocSync(
  parsed: ParsedSalesDocumentImport[]
): Promise<SalesDocSyncPreviewResult> {
  const items: SalesDocSyncPreviewItem[] = [];
  let matched = 0;
  let mismatched = 0;
  let missing = 0;

  for (const doc of parsed) {
    // Calculate 1C total
    const total1C = doc.items.reduce((sum, i) => sum + i.sellingPrice * i.quantity, 0);

    // Try to find in Budvik by document number
    const existing = await prisma.salesDocument.findFirst({
      where: { number: doc.number },
      include: { items: true, counterparty: true },
    });

    if (!existing) {
      missing++;
      items.push({
        number: doc.number,
        date: doc.date,
        customer: doc.customerCode || "",
        itemCount: doc.items.length,
        total1C: Math.round(total1C * 100) / 100,
        action: "create",
      });
      continue;
    }

    // Compare totals
    const totalBudvik = existing.totalAmount;
    const mismatches: { field: string; from: string; to: string }[] = [];

    if (Math.abs(totalBudvik - total1C) > 1) {
      mismatches.push({
        field: "totalAmount",
        from: String(Math.round(totalBudvik * 100) / 100),
        to: String(Math.round(total1C * 100) / 100),
      });
    }

    // Compare item count
    if (existing.items.length !== doc.items.length) {
      mismatches.push({
        field: "itemCount",
        from: String(existing.items.length),
        to: String(doc.items.length),
      });
    }

    if (mismatches.length > 0) {
      mismatched++;
      items.push({
        number: doc.number,
        date: doc.date,
        customer: existing.counterparty?.name || doc.customerCode || "",
        itemCount: doc.items.length,
        total1C: Math.round(total1C * 100) / 100,
        totalBudvik: Math.round(totalBudvik * 100) / 100,
        action: "mismatch",
        mismatches,
      });
    } else {
      matched++;
      items.push({
        number: doc.number,
        date: doc.date,
        customer: existing.counterparty?.name || doc.customerCode || "",
        itemCount: doc.items.length,
        total1C: Math.round(total1C * 100) / 100,
        totalBudvik: Math.round(totalBudvik * 100) / 100,
        action: "matched",
      });
    }
  }

  return { total: parsed.length, matched, mismatched, missing, items };
}

/** Apply sales document sync — import missing docs as read-only (DELIVERED status from 1C) */
export async function applySalesDocSync(
  parsed: ParsedSalesDocumentImport[],
  fileName: string
) {
  const syncJob = await prisma.syncJob.create({
    data: {
      type: "sales_documents",
      status: "running",
      fileName,
      recordsTotal: parsed.length,
    },
  });

  let created = 0;
  let matched = 0;
  let mismatched = 0;
  let failed = 0;
  const errors: string[] = [];

  // We need a system user for createdById
  let systemUser = await prisma.user.findFirst({ where: { email: "system@budvik.ua" } });
  if (!systemUser) {
    systemUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  }
  if (!systemUser) {
    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: { status: "failed", errors: JSON.stringify(["Не знайдено адмін-користувача"]), completedAt: new Date() },
    });
    return { syncJobId: syncJob.id, total: parsed.length, created: 0, matched: 0, mismatched: 0, failed: parsed.length, errors: ["Не знайдено адмін-користувача"], discrepancies: 0 };
  }

  for (const doc of parsed) {
    try {
      const total1C = doc.items.reduce((sum, i) => sum + i.sellingPrice * i.quantity, 0);

      const existing = await prisma.salesDocument.findFirst({
        where: { number: doc.number },
        include: { items: true },
      });

      if (existing) {
        // Compare and log discrepancies
        if (Math.abs(existing.totalAmount - total1C) > 1) {
          await prisma.syncDiscrepancy.create({
            data: {
              syncJobId: syncJob.id,
              entityType: "sales_document",
              entityRef: doc.number,
              entityName: `${doc.number} (${doc.customerCode || ""})`,
              field: "totalAmount",
              value1C: String(Math.round(total1C * 100) / 100),
              valueBudvik: String(Math.round(existing.totalAmount * 100) / 100),
            },
          });
          mismatched++;
        } else {
          matched++;
        }
        continue;
      }

      // Find or skip counterparty
      let counterpartyId: string | null = null;
      if (doc.customerCode) {
        const cp = await prisma.counterparty.findFirst({
          where: { OR: [{ code: doc.customerCode }, { name: doc.customerCode }] },
        });
        counterpartyId = cp?.id || null;
      }

      // Create sales document from 1C data (read-only, DELIVERED status)
      const sd = await prisma.salesDocument.create({
        data: {
          number: doc.number,
          counterpartyId,
          status: "DELIVERED",
          totalAmount: Math.round(total1C * 100) / 100,
          createdById: systemUser.id,
          notes: `Імпортовано з 1С (${fileName})`,
          createdAt: doc.date ? new Date(doc.date) : new Date(),
        },
      });

      // Create items
      for (const item of doc.items) {
        // Find product by SKU or name
        const product = await prisma.product.findFirst({
          where: { OR: [{ sku: item.sku }, { name: item.sku }] },
        });

        if (product) {
          await prisma.salesDocumentItem.create({
            data: {
              salesDocumentId: sd.id,
              productId: product.id,
              quantity: item.quantity,
              sellingPrice: item.sellingPrice,
              purchasePrice: item.purchasePrice || product.wholesalePrice || 0,
            },
          });
        }
      }

      await prisma.syncDiscrepancy.create({
        data: {
          syncJobId: syncJob.id,
          entityType: "sales_document",
          entityRef: doc.number,
          entityName: `${doc.number} (${doc.customerCode || ""})`,
          field: "NEW",
          value1C: `${doc.items.length} позицій, ${Math.round(total1C * 100) / 100} грн`,
          valueBudvik: "не існує",
        },
      });

      created++;
    } catch (e: any) {
      errors.push(`Док. ${doc.number}: ${e.message}`);
      failed++;
    }
  }

  await prisma.syncJob.update({
    where: { id: syncJob.id },
    data: {
      status: failed > 0 && created === 0 ? "failed" : "completed",
      recordsCreated: created,
      recordsUpdated: mismatched,
      recordsSkipped: matched,
      recordsFailed: failed,
      errors: errors.length > 0 ? JSON.stringify(errors.slice(0, 50)) : null,
      completedAt: new Date(),
    },
  });

  return {
    syncJobId: syncJob.id,
    total: parsed.length,
    created,
    matched,
    mismatched,
    failed,
    errors: errors.slice(0, 30),
    discrepancies: created + mismatched,
  };
}
