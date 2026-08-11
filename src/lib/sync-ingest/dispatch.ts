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
      await applySalesDocuments(batch.records as DocumentRecord[], ctx, "ORDER");
      break;
    case "realization_doc":
      await applySalesDocuments(batch.records as DocumentRecord[], ctx, "REALIZATION");
      break;
    case "return_doc":
      await applySalesDocuments(batch.records as DocumentRecord[], ctx, "RETURN");
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
 * Товар при цьому обнуляється по залишку, але лишається активним і видимим.
 * Деактивації немає навмисно: позиція може бути тимчасово прихована в 1С або
 * випасти через помилку вивантаження, а зникнення її з вітрини без відома
 * власника — гірша шкода. А от застарілий залишок — це пряма брехня покупцеві
 * («в наявності» для того, чого в обліку вже немає), тому нуль ставимо одразу:
 * картка стає сірою, без кнопки кошика, і падає в кінець списку.
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
      select: { id: true, externalId: true, sku: true, name: true, stock: true },
    });

    const missing = onSite.filter((p) => !snapshot.has(p.externalId!));
    const known = await unresolvedRefs("product", "MISSING");

    for (const p of missing) {
      const ref = p.sku || p.externalId!;
      // Повний прогін ходить щодня, а розбіжність живе до розв'язання: без
      // цієї перевірки та сама позиція накопичувала б новий запис щоночі.
      if (known.has(ref)) continue;
      ctx.discrepancy({
        entityType: "product",
        entityRef: ref,
        entityName: p.name,
        field: "MISSING",
        value1C: "немає в 1С",
        valueBudvik: `активний, залишок ${p.stock}`,
      });
    }

    if (!ctx.isPreview) {
      await zeroStock(missing.filter((p) => p.stock !== 0).map((p) => p.id));
    }

    return missing.length;
  }

  if (entityType === "counterparty") {
    const onSite = await prisma.counterparty.findMany({
      where: { externalId: { not: null }, isActive: true },
      select: { externalId: true, code: true, name: true },
    });

    const missing = onSite.filter((c) => !snapshot.has(c.externalId!));
    const known = await unresolvedRefs("counterparty", "MISSING");

    for (const c of missing) {
      const ref = c.code || c.externalId!;
      if (known.has(ref)) continue;
      ctx.discrepancy({
        entityType: "counterparty",
        entityRef: ref,
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

/** Ref'и вже зареєстрованих і ще не розв'язаних розбіжностей одного виду. */
async function unresolvedRefs(entityType: string, field: string): Promise<Set<string>> {
  const rows = await prisma.syncDiscrepancy.findMany({
    where: { entityType, field, resolved: false },
    select: { entityRef: true },
  });
  return new Set(rows.map((r) => r.entityRef));
}

/**
 * Обнуляє залишок товарів, яких більше немає в 1С — і в Product.stock, і в
 * поскладових рядках, інакше наступний перерахунок підняв би старе число назад.
 */
async function zeroStock(productIds: string[]): Promise<void> {
  if (productIds.length === 0) return;

  const CHUNK = 500;
  for (let i = 0; i < productIds.length; i += CHUNK) {
    const ids = productIds.slice(i, i + CHUNK);
    try {
      await prisma.locationStock.updateMany({
        where: { productId: { in: ids } },
        data: { quantity: 0, reserved: 0, available: 0 },
      });
      await prisma.product.updateMany({
        where: { id: { in: ids } },
        data: { stock: 0, syncedAt: new Date(), syncSource: "1C" },
      });
    } catch (e) {
      // Обнулення — гігієна вітрини, а не суть прогону: збій тут не має
      // валити батч, у якому щойно успішно застосувались ціни й залишки.
      console.error("sync-ingest: не вдалося обнулити залишок зниклих товарів", e);
    }
  }
}
