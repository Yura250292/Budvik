import { prisma } from "@/lib/prisma";
import { parseCSV, parseCommerceML, generateSlug, type ParsedProduct } from "@/lib/import-1c";
import crypto from "crypto";

function generateSKU(name: string): string {
  const hash = crypto.createHash("md5").update(name).digest("hex").slice(0, 8).toUpperCase();
  return `1C-${hash}`;
}

export interface SyncPreviewItem {
  sku: string;
  name: string;
  action: "create" | "update" | "unchanged";
  changes?: { field: string; from: string; to: string }[];
  value1C: { price?: number; stock?: number; name: string };
  valueBudvik?: { price?: number; stock?: number; name: string };
}

export interface SyncPreviewResult {
  total: number;
  toCreate: number;
  toUpdate: number;
  unchanged: number;
  items: SyncPreviewItem[];
}

export interface SyncApplyResult {
  syncJobId: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
  discrepancies: number;
}

/** Parse file content into ParsedProduct[] based on filename extension */
export function parseFileToProducts(content: string, fileName: string): ParsedProduct[] {
  const ext = fileName.toLowerCase();
  if (ext.endsWith(".xml")) {
    const result = parseCommerceML(content);
    return result.products;
  }
  return parseCSV(content);
}

/** Preview what will change without writing to DB */
export async function previewProductSync(parsed: ParsedProduct[]): Promise<SyncPreviewResult> {
  const items: SyncPreviewItem[] = [];
  let toCreate = 0;
  let toUpdate = 0;
  let unchanged = 0;

  for (const p of parsed) {
    const sku = p.sku || generateSKU(p.name);

    // Try to find existing product by SKU, then by exact name
    const existing = await prisma.product.findFirst({
      where: { OR: [{ sku }, { name: p.name }] },
      select: { sku: true, name: true, price: true, wholesalePrice: true, stock: true },
    });

    if (!existing) {
      toCreate++;
      items.push({
        sku,
        name: p.name,
        action: "create",
        value1C: { price: p.price, stock: p.stock, name: p.name },
      });
      continue;
    }

    // Compare fields
    const changes: { field: string; from: string; to: string }[] = [];

    if (p.price !== undefined && Math.abs((existing.price || 0) - p.price) > 0.01) {
      changes.push({ field: "price", from: String(existing.price || 0), to: String(p.price) });
    }
    if (p.stock !== undefined && existing.stock !== p.stock) {
      changes.push({ field: "stock", from: String(existing.stock), to: String(p.stock) });
    }

    if (changes.length > 0) {
      toUpdate++;
      items.push({
        sku: existing.sku || sku,
        name: p.name,
        action: "update",
        changes,
        value1C: { price: p.price, stock: p.stock, name: p.name },
        valueBudvik: { price: existing.price, stock: existing.stock, name: existing.name },
      });
    } else {
      unchanged++;
      items.push({
        sku: existing.sku || sku,
        name: p.name,
        action: "unchanged",
        value1C: { price: p.price, stock: p.stock, name: p.name },
        valueBudvik: { price: existing.price, stock: existing.stock, name: existing.name },
      });
    }
  }

  return { total: parsed.length, toCreate, toUpdate, unchanged, items };
}

/** Apply product sync — actually write changes to DB */
export async function applyProductSync(
  parsed: ParsedProduct[],
  fileName: string
): Promise<SyncApplyResult> {
  const syncJob = await prisma.syncJob.create({
    data: {
      type: "products",
      status: "running",
      fileName,
      recordsTotal: parsed.length,
    },
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];
  let discrepancyCount = 0;

  // Ensure default category for new products
  let defaultCategory = await prisma.category.findFirst({ where: { slug: "import-z-1s" } });
  if (!defaultCategory) {
    defaultCategory = await prisma.category.create({
      data: { name: "Імпорт з 1С", slug: "import-z-1s" },
    });
  }

  for (const p of parsed) {
    try {
      const sku = p.sku || generateSKU(p.name);

      const existing = await prisma.product.findFirst({
        where: { OR: [{ sku }, { name: p.name }] },
      });

      if (!existing) {
        // Create new product
        let slug = generateSlug(p.name) || `product-${Date.now()}`;
        const slugExists = await prisma.product.findFirst({ where: { slug } });
        if (slugExists) slug = `${slug}-${Date.now().toString(36)}`;

        const skuExists = await prisma.product.findFirst({ where: { sku } });

        await prisma.product.create({
          data: {
            name: p.name,
            slug,
            sku: skuExists ? `${sku}-${Date.now().toString(36)}` : sku,
            description: p.description || "",
            price: p.price && !isNaN(p.price) ? p.price : 0,
            stock: p.stock && !isNaN(p.stock) ? p.stock : 0,
            categoryId: defaultCategory.id,
            isActive: true,
            syncedAt: new Date(),
            syncSource: "1C",
          },
        });

        // Record discrepancy for new item
        await prisma.syncDiscrepancy.create({
          data: {
            syncJobId: syncJob.id,
            entityType: "product",
            entityRef: sku,
            entityName: p.name,
            field: "NEW",
            value1C: `price: ${p.price ?? 0}, stock: ${p.stock ?? 0}`,
            valueBudvik: "не існує",
          },
        });
        discrepancyCount++;
        created++;
        continue;
      }

      // Compare and update existing
      const updates: Record<string, any> = {};
      const discrepancies: { field: string; v1c: string; vBud: string }[] = [];

      if (p.price !== undefined && Math.abs((existing.price || 0) - p.price) > 0.01) {
        discrepancies.push({ field: "price", v1c: String(p.price), vBud: String(existing.price) });
        updates.price = p.price;
      }
      if (p.stock !== undefined && existing.stock !== p.stock) {
        discrepancies.push({ field: "stock", v1c: String(p.stock), vBud: String(existing.stock) });
        updates.stock = p.stock;
      }

      if (Object.keys(updates).length > 0) {
        updates.syncedAt = new Date();
        updates.syncSource = "1C";
        await prisma.product.update({ where: { id: existing.id }, data: updates });

        for (const d of discrepancies) {
          await prisma.syncDiscrepancy.create({
            data: {
              syncJobId: syncJob.id,
              entityType: "product",
              entityRef: existing.sku || sku,
              entityName: p.name,
              field: d.field,
              value1C: d.v1c,
              valueBudvik: d.vBud,
            },
          });
          discrepancyCount++;
        }
        updated++;
      } else {
        // Just update sync timestamp
        await prisma.product.update({
          where: { id: existing.id },
          data: { syncedAt: new Date(), syncSource: "1C" },
        });
        skipped++;
      }
    } catch (e: any) {
      errors.push(`"${p.name.slice(0, 40)}": ${e.message}`);
      failed++;
    }
  }

  // Update sync job
  await prisma.syncJob.update({
    where: { id: syncJob.id },
    data: {
      status: failed > 0 && created === 0 && updated === 0 ? "failed" : "completed",
      recordsCreated: created,
      recordsUpdated: updated,
      recordsSkipped: skipped,
      recordsFailed: failed,
      errors: errors.length > 0 ? JSON.stringify(errors.slice(0, 50)) : null,
      completedAt: new Date(),
    },
  });

  return {
    syncJobId: syncJob.id,
    total: parsed.length,
    created,
    updated,
    skipped,
    failed,
    errors: errors.slice(0, 30),
    discrepancies: discrepancyCount,
  };
}
