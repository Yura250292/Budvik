import { prisma } from "@/lib/prisma";
import { parsePurchaseDocumentsCSV, parsePurchaseDocumentsXML, type ParsedPurchaseDocument } from "@/lib/import-1c";

export interface PurchaseDocSyncPreviewItem {
  number: string;
  date: string;
  supplier: string;
  itemCount: number;
  total1C: number;
  totalBudvik?: number;
  action: "create" | "mismatch" | "matched";
  mismatches?: { field: string; from: string; to: string }[];
}

export interface PurchaseDocSyncPreviewResult {
  total: number;
  matched: number;
  mismatched: number;
  missing: number;
  items: PurchaseDocSyncPreviewItem[];
}

/** Parse file content into purchase documents */
export function parseFileToPurchaseDocs(content: string, fileName: string): ParsedPurchaseDocument[] {
  const ext = fileName.toLowerCase();
  if (ext.endsWith(".xml")) return parsePurchaseDocumentsXML(content);
  return parsePurchaseDocumentsCSV(content);
}

/** Preview purchase document sync */
export async function previewPurchaseDocSync(
  parsed: ParsedPurchaseDocument[]
): Promise<PurchaseDocSyncPreviewResult> {
  const items: PurchaseDocSyncPreviewItem[] = [];
  let matched = 0;
  let mismatched = 0;
  let missing = 0;

  for (const doc of parsed) {
    const total1C = doc.items.reduce((sum, i) => sum + i.purchasePrice * i.quantity, 0);

    const existing = await prisma.purchaseOrder.findFirst({
      where: { number: doc.number },
      include: { items: true, supplier: true },
    });

    if (!existing) {
      missing++;
      items.push({
        number: doc.number,
        date: doc.date,
        supplier: doc.supplierCode,
        itemCount: doc.items.length,
        total1C: Math.round(total1C * 100) / 100,
        action: "create",
      });
      continue;
    }

    const totalBudvik = existing.totalAmount;
    const mismatches: { field: string; from: string; to: string }[] = [];

    if (Math.abs(totalBudvik - total1C) > 1) {
      mismatches.push({
        field: "totalAmount",
        from: String(Math.round(totalBudvik * 100) / 100),
        to: String(Math.round(total1C * 100) / 100),
      });
    }

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
        supplier: existing.supplier?.name || doc.supplierCode,
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
        supplier: existing.supplier?.name || doc.supplierCode,
        itemCount: doc.items.length,
        total1C: Math.round(total1C * 100) / 100,
        totalBudvik: Math.round(totalBudvik * 100) / 100,
        action: "matched",
      });
    }
  }

  return { total: parsed.length, matched, mismatched, missing, items };
}

/** Apply purchase document sync */
export async function applyPurchaseDocSync(
  parsed: ParsedPurchaseDocument[],
  fileName: string
) {
  const syncJob = await prisma.syncJob.create({
    data: {
      type: "purchase_orders",
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
      const total1C = doc.items.reduce((sum, i) => sum + i.purchasePrice * i.quantity, 0);

      const existing = await prisma.purchaseOrder.findFirst({
        where: { number: doc.number },
        include: { items: true },
      });

      if (existing) {
        if (Math.abs(existing.totalAmount - total1C) > 1) {
          await prisma.syncDiscrepancy.create({
            data: {
              syncJobId: syncJob.id,
              entityType: "purchase_order",
              entityRef: doc.number,
              entityName: `${doc.number} (${doc.supplierCode})`,
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

      // Find supplier
      let supplierId: string | null = null;
      if (doc.supplierCode) {
        const sup = await prisma.counterparty.findFirst({
          where: { OR: [{ code: doc.supplierCode }, { name: doc.supplierCode }] },
        });
        supplierId = sup?.id || null;
      }

      if (!supplierId) {
        errors.push(`Док. ${doc.number}: Постачальника "${doc.supplierCode}" не знайдено`);
        failed++;
        continue;
      }

      const po = await prisma.purchaseOrder.create({
        data: {
          number: doc.number,
          supplierId,
          status: "CONFIRMED",
          totalAmount: Math.round(total1C * 100) / 100,
          createdById: systemUser.id,
          notes: `Імпортовано з 1С (${fileName})`,
          confirmedAt: doc.date ? new Date(doc.date) : new Date(),
          createdAt: doc.date ? new Date(doc.date) : new Date(),
        },
      });

      for (const item of doc.items) {
        const product = await prisma.product.findFirst({
          where: { OR: [{ sku: item.sku }, { name: item.sku }] },
        });

        if (product) {
          await prisma.purchaseOrderItem.create({
            data: {
              purchaseOrderId: po.id,
              productId: product.id,
              quantity: item.quantity,
              purchasePrice: item.purchasePrice,
            },
          });
        }
      }

      await prisma.syncDiscrepancy.create({
        data: {
          syncJobId: syncJob.id,
          entityType: "purchase_order",
          entityRef: doc.number,
          entityName: `${doc.number} (${doc.supplierCode})`,
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
