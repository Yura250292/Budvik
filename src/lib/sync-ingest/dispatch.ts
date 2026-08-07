/**
 * Диспетчер батчів: маршрутизує записи за entityType у відповідний apply-модуль
 * і обробляє повний зріз (fullSnapshotIds) для виявлення зниклих сутностей.
 */

import { prisma } from "@/lib/prisma";
import type {
  BatchRequest,
  CategoryRecord,
  CounterpartyRecord,
  DebtRecord,
  PaymentRecord,
  DocumentRecord,
  PriceRecord,
  ProductRecord,
  StockRecord,
  SyncEntityType,
  WarehouseRecord,
} from "./types";
import { ApplyContext } from "./context";
import { applyProducts } from "./apply-products";
import { applyPrices } from "./apply-prices";
import { applyCategories } from "./apply-categories";
import { applyStock, applyWarehouses } from "./apply-stock";
import { applyCounterparties, applyDebts } from "./apply-counterparties";
import { applySalesDocuments, applyPurchaseDocuments } from "./apply-documents";
import { applyPayments } from "./apply-payments";

export async function dispatchBatch(
  batch: BatchRequest,
  ctx: ApplyContext
): Promise<void> {
  switch (batch.entityType) {
    case "category":
      await applyCategories(batch.records as CategoryRecord[], ctx);
      break;
    case "product":
      await applyProducts(batch.records as ProductRecord[], ctx);
      break;
    case "price":
      await applyPrices(batch.records as PriceRecord[], ctx);
      break;
    case "warehouse":
      await applyWarehouses(batch.records as WarehouseRecord[], ctx);
      break;
    case "stock":
      await applyStock(batch.records as StockRecord[], ctx);
      break;
    case "counterparty":
      await applyCounterparties(batch.records as CounterpartyRecord[], ctx);
      break;
    case "sales_doc":
      await applySalesDocuments(batch.records as DocumentRecord[], ctx);
      break;
    case "purchase_doc":
      await applyPurchaseDocuments(batch.records as DocumentRecord[], ctx);
      break;
    case "debt":
      await applyDebts(batch.records as DebtRecord[], ctx);
      break;
    case "payment":
      await applyPayments(batch.records as PaymentRecord[], ctx);
      break;
    default: {
      // Вичерпність switch перевіряється компілятором.
      const exhaustive: never = batch.entityType;
      throw new Error(`Невідомий тип сутності: ${String(exhaustive)}`);
    }
  }
}

/**
 * Порівнює повний зріз активних externalId з 1С проти того, що є на сайті,
 * і реєструє відсутні як MISSING.
 *
 * Автодеактивації тут навмисно немає: товар може бути тимчасово прихований
 * у 1С або випасти через помилку вивантаження, а зникнення позиції з вітрини
 * без відома власника — гірша шкода, ніж застарілий залишок.
 */
export async function detectMissing(
  entityType: SyncEntityType,
  snapshotIds: string[],
  ctx: ApplyContext
): Promise<number> {
  const snapshot = new Set(snapshotIds);

  if (entityType === "product") {
    const onSite = await prisma.product.findMany({
      where: { externalId: { not: null }, isActive: true },
      select: { externalId: true, sku: true, name: true, stock: true },
    });

    const missing = onSite.filter((p) => !snapshot.has(p.externalId!));
    for (const p of missing) {
      ctx.discrepancy({
        entityType: "product",
        entityRef: p.sku || p.externalId!,
        entityName: p.name,
        field: "MISSING",
        value1C: "немає в 1С",
        valueBudvik: `активний, залишок ${p.stock}`,
      });
    }
    return missing.length;
  }

  if (entityType === "counterparty") {
    const onSite = await prisma.counterparty.findMany({
      where: { externalId: { not: null }, isActive: true },
      select: { externalId: true, code: true, name: true },
    });

    const missing = onSite.filter((c) => !snapshot.has(c.externalId!));
    for (const c of missing) {
      ctx.discrepancy({
        entityType: "counterparty",
        entityRef: c.code || c.externalId!,
        entityName: c.name,
        field: "MISSING",
        value1C: "немає в 1С",
        valueBudvik: "активний на сайті",
      });
    }
    return missing.length;
  }

  // Для решти типів (ціни, залишки, документи) повний зріз змісту не має:
  // відсутність запису там означає нуль, а не зникнення сутності.
  return 0;
}
