/**
 * Застосування цін із зрізу 1С.
 *
 * Промо-поля (isPromo/promoPrice/promoLabel) — власність сайту, синхронізація
 * їх не торкається: акція живе в маркетингу, а не в обліку.
 *
 * Захист від помилок в 1С: зміна ціни більш ніж у PRICE_SANITY_FACTOR разів
 * не застосовується, а лише реєструється як розбіжність. Типова причина —
 * зміна одиниці виміру (ціна за упаковку замість штуки) або помилка оператора.
 */

import { prisma } from "@/lib/prisma";
import type { PriceRecord } from "./types";
import { ApplyContext } from "./context";

const PRICE_EPSILON = 0.01;
const PRICE_SANITY_FACTOR = 5;

/** Чи виглядає нова ціна як помилка на тлі старої. */
function isSuspicious(oldPrice: number, newPrice: number): boolean {
  if (oldPrice <= 0 || newPrice <= 0) return false; // з/на нуль — легітимно
  const ratio = newPrice > oldPrice ? newPrice / oldPrice : oldPrice / newPrice;
  return ratio > PRICE_SANITY_FACTOR;
}

export async function applyPrices(records: PriceRecord[], ctx: ApplyContext): Promise<void> {
  if (records.length === 0) return;

  const externalIds = records.map((r) => r.externalId);

  const products = await prisma.product.findMany({
    where: { externalId: { in: externalIds } },
    select: { id: true, externalId: true, sku: true, name: true, price: true, wholesalePrice: true },
  });
  const byExternalId = new Map(products.map((p) => [p.externalId!, p]));

  // «Ціну підтвердив зріз 1С» — до циклу, одним запитом, годинником бази.
  // Та сама механіка, що для сальдо дебіторки, і з тих самих причин:
  // зріз віддає лише ціни > 0, тож прибрана ціна не приходить нулем, а
  // позиція просто зникає з вивантаження. Див. reconcile-prices.ts.
  if (!ctx.isPreview) {
    await prisma.$executeRaw`
      UPDATE "Product" SET "priceSyncedAt" = now()
      WHERE "externalId" = ANY(${externalIds}::text[])
    `;
  }

  for (const rec of records) {
    const product = byExternalId.get(rec.externalId);

    // Ціна на товар, якого ще немає на сайті — нормально, якщо батч товарів
    // ще не доїхав. Наступний цикл підхопить.
    if (!product) {
      ctx.skipped++;
      continue;
    }

    const updates: Record<string, number> = {};

    if (rec.retail !== undefined && Number.isFinite(rec.retail)) {
      if (Math.abs((product.price || 0) - rec.retail) > PRICE_EPSILON) {
        if (isSuspicious(product.price || 0, rec.retail)) {
          ctx.discrepancy({
            entityType: "product",
            entityRef: product.sku || rec.externalId,
            entityName: product.name,
            field: "price_rejected",
            value1C: String(rec.retail),
            valueBudvik: String(product.price),
          });
        } else {
          ctx.discrepancy({
            entityType: "product",
            entityRef: product.sku || rec.externalId,
            entityName: product.name,
            field: "price",
            value1C: String(rec.retail),
            valueBudvik: String(product.price),
          });
          updates.price = rec.retail;
        }
      }
    }

    if (rec.wholesale !== undefined && Number.isFinite(rec.wholesale)) {
      const current = product.wholesalePrice ?? 0;
      if (Math.abs(current - rec.wholesale) > PRICE_EPSILON) {
        if (isSuspicious(current, rec.wholesale)) {
          ctx.discrepancy({
            entityType: "product",
            entityRef: product.sku || rec.externalId,
            entityName: product.name,
            field: "wholesalePrice_rejected",
            value1C: String(rec.wholesale),
            valueBudvik: String(product.wholesalePrice ?? "—"),
          });
        } else {
          updates.wholesalePrice = rec.wholesale;
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      ctx.skipped++;
      continue;
    }

    if (ctx.isPreview) {
      ctx.updated++;
      continue;
    }

    try {
      await prisma.product.update({
        where: { id: product.id },
        data: { ...updates, syncedAt: new Date(), syncSource: "1C" },
      });
      ctx.updated++;
    } catch (e) {
      ctx.fail(product.name, e);
    }
  }
}
