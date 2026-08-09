/**
 * Склади (StockLocation) і залишки по складах (LocationStock).
 *
 * Product.stock — похідна величина: сума залишків по всіх складах. Тому після
 * запису LocationStock ми перераховуємо загальний залишок одним запитом на
 * товар. Це усуває розбіжність, яка була в ручному імпорті: там писався лише
 * Product.stock, а LocationStock лишався порожнім.
 */

import { prisma } from "@/lib/prisma";
import type { StockRecord, WarehouseRecord } from "./types";
import { ApplyContext } from "./context";

export async function applyWarehouses(
  records: WarehouseRecord[],
  ctx: ApplyContext
): Promise<void> {
  if (records.length === 0) return;

  const existing = await prisma.stockLocation.findMany({
    where: { externalId: { in: records.map((r) => r.externalId) } },
    select: { id: true, externalId: true, name: true, address: true },
  });
  const byExternalId = new Map(existing.map((w) => [w.externalId!, w]));

  for (const rec of records) {
    if (!rec.name?.trim()) {
      ctx.skipped++;
      continue;
    }

    const found = byExternalId.get(rec.externalId);

    if (!found) {
      if (ctx.isPreview) {
        ctx.created++;
        continue;
      }
      try {
        await prisma.stockLocation.create({
          data: {
            externalId: rec.externalId,
            name: rec.name,
            address: rec.address || null,
          },
        });
        ctx.created++;
      } catch (e) {
        ctx.fail(rec.name, e);
      }
      continue;
    }

    const changedName = found.name !== rec.name;
    const changedAddress = !!rec.address && found.address !== rec.address;

    if (!changedName && !changedAddress) {
      ctx.skipped++;
      continue;
    }

    if (ctx.isPreview) {
      ctx.updated++;
      continue;
    }

    try {
      await prisma.stockLocation.update({
        where: { id: found.id },
        data: {
          ...(changedName ? { name: rec.name } : {}),
          ...(changedAddress ? { address: rec.address } : {}),
        },
      });
      ctx.updated++;
    } catch (e) {
      ctx.fail(rec.name, e);
    }
  }
}

export async function applyStock(records: StockRecord[], ctx: ApplyContext): Promise<void> {
  if (records.length === 0) return;

  const products = await prisma.product.findMany({
    where: { externalId: { in: [...new Set(records.map((r) => r.externalId))] } },
    select: { id: true, externalId: true, sku: true, name: true, stock: true },
  });
  const productByExternalId = new Map(products.map((p) => [p.externalId!, p]));

  const warehouses = await prisma.stockLocation.findMany({
    where: { externalId: { in: [...new Set(records.map((r) => r.warehouseExternalId))] } },
    select: { id: true, externalId: true },
  });
  const warehouseByExternalId = new Map(warehouses.map((w) => [w.externalId!, w.id]));

  // Товари, чий сумарний залишок треба перерахувати після запису.
  const touchedProductIds = new Set<string>();

  for (const rec of records) {
    const product = productByExternalId.get(rec.externalId);
    const warehouseId = warehouseByExternalId.get(rec.warehouseExternalId);

    // Товар чи склад ще не синхронізовані — наступний цикл підхопить.
    if (!product || !warehouseId) {
      ctx.skipped++;
      continue;
    }

    const quantity = Number.isFinite(rec.quantity) ? Math.max(0, Math.round(rec.quantity)) : 0;

    if (ctx.isPreview) {
      const current = await prisma.locationStock.findUnique({
        where: { stockLocationId_productId: { stockLocationId: warehouseId, productId: product.id } },
        select: { quantity: true },
      });
      if ((current?.quantity ?? 0) !== quantity) {
        ctx.updated++;
        ctx.discrepancy({
          entityType: "product",
          entityRef: product.sku || rec.externalId,
          entityName: product.name,
          field: "stock",
          value1C: String(quantity),
          valueBudvik: String(current?.quantity ?? 0),
        });
      } else {
        ctx.skipped++;
      }
      continue;
    }

    try {
      await prisma.locationStock.upsert({
        where: {
          stockLocationId_productId: { stockLocationId: warehouseId, productId: product.id },
        },
        create: { stockLocationId: warehouseId, productId: product.id, quantity },
        update: { quantity },
      });
      touchedProductIds.add(product.id);
      ctx.updated++;
    } catch (e) {
      ctx.fail(product.name, e);
    }
  }

  if (touchedProductIds.size === 0) return;

  // Перерахунок сумарного залишку по зачеплених товарах.
  const totals = await prisma.locationStock.groupBy({
    by: ["productId"],
    where: { productId: { in: [...touchedProductIds] } },
    _sum: { quantity: true },
  });

  for (const t of totals) {
    const total = t._sum.quantity ?? 0;
    const product = products.find((p) => p.id === t.productId);
    if (product && product.stock === total) continue;

    if (product) {
      ctx.discrepancy({
        entityType: "product",
        entityRef: product.sku || product.externalId || product.id,
        entityName: product.name,
        field: "stock",
        value1C: String(total),
        valueBudvik: String(product.stock),
      });
    }

    try {
      await prisma.product.update({
        where: { id: t.productId },
        data: { stock: total, syncedAt: new Date(), syncSource: "1C" },
      });
    } catch (e) {
      ctx.fail(`stock:${t.productId}`, e);
    }
  }
}
