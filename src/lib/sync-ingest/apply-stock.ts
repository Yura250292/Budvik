/**
 * Склади (StockLocation) і залишки по складах (LocationStock).
 *
 * Product.stock — похідна величина: сума залишків по складах, з яких МОЖНА
 * продавати. Тому після запису LocationStock ми перераховуємо загальний
 * залишок одним запитом на товар. Це усуває розбіжність, яка була в ручному
 * імпорті: там писався лише Product.stock, а LocationStock лишався порожнім.
 */

import { prisma } from "@/lib/prisma";
import type { StockRecord, WarehouseRecord } from "./types";
import { ApplyContext } from "./context";

/**
 * Чи це склад, з якого не продають: брак, уцінка, майстерня, ремонти.
 *
 * У 1С під гарантійний процес заведено окремий ланцюжок складів («Зламані
 * вироби для передачі на ремонт» → «Ремонти» → «Відремонтовані вироби на
 * відгрузку»), і товар на них фізично існує. Але це не асортимент: поки він
 * там, продати його не можна.
 *
 * Розпізнаємо за назвою, бо ознаки складу 1С не передає. Перевірено на всіх
 * 16 складах бази: сім сервісних ловляться, жоден продажний не зачеплений.
 */
const SERVICE_PATTERNS = [
  "РЕМОНТ",
  "БРАК",
  "ПЕРЕОЦ",
  "УЦІНК",
  "ЗЛАМАН",
  "МАЙСТЕРН",
  "СЕРВІС",
  "СЕРВИС",
  "НЕКОНДИЦ",
];

export function isServiceWarehouse(name: string): boolean {
  const upper = name.toUpperCase();
  return SERVICE_PATTERNS.some((p) => upper.includes(p));
}

export async function applyWarehouses(
  records: WarehouseRecord[],
  ctx: ApplyContext
): Promise<void> {
  if (records.length === 0) return;

  const existing = await prisma.stockLocation.findMany({
    where: { externalId: { in: records.map((r) => r.externalId) } },
    select: { id: true, externalId: true, name: true, address: true, isService: true },
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
            isService: isServiceWarehouse(rec.name),
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
    // Ознака сервісного складу виводиться з назви, тож перейменування в 1С
    // може перевести склад у сервісні й назад.
    const service = isServiceWarehouse(rec.name);
    const changedService = found.isService !== service;

    if (!changedName && !changedAddress && !changedService) {
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
          ...(changedService ? { isService: service } : {}),
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
    const reserved = Number.isFinite(rec.reserved) ? Math.max(0, Math.round(rec.reserved!)) : 0;
    // Довіряємо available з агента, але перераховуємо, якщо його не надіслали
    // (старіша версія агента) — щоб поле ніколи не лишалось нулем при
    // наявному залишку.
    const available = Number.isFinite(rec.available)
      ? Math.max(0, Math.round(rec.available!))
      : Math.max(0, quantity - reserved);

    if (ctx.isPreview) {
      const current = await prisma.locationStock.findUnique({
        where: { stockLocationId_productId: { stockLocationId: warehouseId, productId: product.id } },
        select: { quantity: true, reserved: true, available: true },
      });
      if (
        (current?.quantity ?? 0) !== quantity ||
        (current?.reserved ?? 0) !== reserved ||
        (current?.available ?? 0) !== available
      ) {
        ctx.updated++;
        ctx.discrepancy({
          entityType: "product",
          entityRef: product.sku || rec.externalId,
          entityName: product.name,
          field: "stock",
          value1C: `${quantity} (резерв ${reserved}, вільно ${available})`,
          valueBudvik: `${current?.quantity ?? 0} (резерв ${current?.reserved ?? 0}, вільно ${current?.available ?? 0})`,
        });
      } else {
        ctx.skipped++;
      }
      continue;
    }

    try {
      // syncedAt пишемо завжди, навіть коли числа не змінились: на цій мітці
      // тримається звірка наявності (reconcile-stock.ts). Регістр віддає лише
      // ненульові рядки, тож продана в нуль пара просто зникає з вивантаження,
      // і відрізнити її від незміненої можна тільки за свіжістю мітки.
      await prisma.locationStock.upsert({
        where: {
          stockLocationId_productId: { stockLocationId: warehouseId, productId: product.id },
        },
        create: {
          stockLocationId: warehouseId,
          productId: product.id,
          quantity,
          reserved,
          available,
          syncedAt: new Date(),
        },
        update: { quantity, reserved, available, syncedAt: new Date() },
      });
      touchedProductIds.add(product.id);
      ctx.updated++;
    } catch (e) {
      ctx.fail(product.name, e);
    }
  }

  if (touchedProductIds.size === 0) return;

  // Перерахунок сумарного залишку по зачеплених товарах.
  //
  // Product.stock — це ВІЛЬНИЙ залишок, а не фізичний: саме він визначає, що
  // можна продати. Фізичний лишається доступним по складах у LocationStock —
  // складу він потрібен, щоб зібрати замовлення.
  //
  // Сервісні склади сюди не входять. Товар на «Складі Браку» чи в майстерні
  // фізично є, але продавати його не можна: доти 43 такі позиції висіли у
  // вітрині як звичайний товар.
  const totals = await prisma.locationStock.groupBy({
    by: ["productId"],
    where: {
      productId: { in: [...touchedProductIds] },
      stockLocation: { isService: false },
    },
    _sum: { available: true },
  });
  const totalByProduct = new Map(totals.map((t) => [t.productId, t._sum.available ?? 0]));

  // Перебираємо ЗАЧЕПЛЕНІ товари, а не результат groupBy: товар, який лежить
  // лише на сервісному складі, у вибірку не потрапляє взагалі — і якби ми
  // йшли по ній, його залишок так і лишився б старим, ненульовим.
  for (const productId of touchedProductIds) {
    const total = totalByProduct.get(productId) ?? 0;
    const product = products.find((p) => p.id === productId);
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
        where: { id: productId },
        data: { stock: total, syncedAt: new Date(), syncSource: "1C" },
      });
    } catch (e) {
      ctx.fail(`stock:${productId}`, e);
    }
  }
}
