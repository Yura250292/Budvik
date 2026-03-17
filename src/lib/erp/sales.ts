import { prisma } from "@/lib/prisma";
import { extractBrand } from "@/lib/wholesale-pricing";

/**
 * Status flow:
 * DRAFT → CONFIRMED (manager approves) → PACKING (warehouse) → IN_TRANSIT (driver) → DELIVERED
 * Any status → CANCELLED (releases reservations if not yet dispatched, restores stock if dispatched)
 */

/** Manager confirms an order — stock stays reserved, commissions created */
export async function confirmSalesDocument(id: string) {
  const doc = await prisma.salesDocument.findUnique({
    where: { id },
    include: { items: { include: { product: true } } },
  });

  if (!doc) throw new Error("Документ не знайдено");
  if (doc.status !== "DRAFT") throw new Error("Можна підтвердити тільки чернетку");
  if (!doc.salesRepId) throw new Error("Не вказано торгового менеджера");

  await prisma.$transaction(async (tx) => {
    let totalAmount = 0;
    let totalCost = 0;

    // Verify reservations are still valid
    for (const item of doc.items) {
      if (item.product.stock < item.quantity) {
        throw new Error(`Недостатньо товару "${item.product.name}" (залишок: ${item.product.stock})`);
      }
      totalAmount += item.sellingPrice * item.quantity;
      totalCost += item.purchasePrice * item.quantity;
    }

    const profitAmount = totalAmount - totalCost;
    const discountAmount = doc.items.reduce(
      (sum, item) => sum + (item.discountPercent > 0 ? (item.sellingPrice * item.quantity * item.discountPercent) / 100 : 0),
      0
    );

    // Create commission records grouped by brand
    const brandGroups = new Map<string, { saleAmount: number; costAmount: number }>();
    for (const item of doc.items) {
      const brand = extractBrand(item.product.name) || "ІНШЕ";
      const existing = brandGroups.get(brand) || { saleAmount: 0, costAmount: 0 };
      existing.saleAmount += item.sellingPrice * item.quantity;
      existing.costAmount += item.purchasePrice * item.quantity;
      brandGroups.set(brand, existing);
    }

    for (const [brand, amounts] of brandGroups) {
      const profit = amounts.saleAmount - amounts.costAmount;
      const rate = await tx.commissionRate.findUnique({
        where: { salesRepId_brand: { salesRepId: doc.salesRepId!, brand } },
      });
      const commissionRate = rate?.percentage || 0;
      const commissionAmount = profit > 0 ? (profit * commissionRate) / 100 : 0;

      await tx.commissionRecord.create({
        data: {
          salesRepId: doc.salesRepId!,
          salesDocumentId: id,
          brand,
          saleAmount: amounts.saleAmount,
          costAmount: amounts.costAmount,
          profitAmount: profit,
          commissionRate,
          commissionAmount,
        },
      });
    }

    await tx.salesDocument.update({
      where: { id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        totalAmount,
        discountAmount,
        profitAmount,
      },
    });
  });
}

/** Warehouse marks order as being packed */
export async function startPackingSalesDocument(id: string) {
  const doc = await prisma.salesDocument.findUnique({ where: { id } });
  if (!doc) throw new Error("Документ не знайдено");
  if (doc.status !== "CONFIRMED") throw new Error("Можна пакувати тільки підтверджений документ");

  await prisma.salesDocument.update({
    where: { id },
    data: { status: "PACKING" },
  });
}

/** Mark order as in transit — actually deducts stock and releases reservations */
export async function dispatchSalesDocument(id: string) {
  const doc = await prisma.salesDocument.findUnique({
    where: { id },
    include: { items: true, reservations: true },
  });

  if (!doc) throw new Error("Документ не знайдено");
  if (doc.status !== "PACKING") throw new Error("Можна відправити тільки запакований документ");

  await prisma.$transaction(async (tx) => {
    // Deduct actual stock
    for (const item of doc.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      });
    }

    // Remove reservations (stock is now physically deducted)
    await tx.stockReservation.deleteMany({ where: { salesDocumentId: id } });

    await tx.salesDocument.update({
      where: { id },
      data: { status: "IN_TRANSIT" },
    });
  });
}

/** Mark order as delivered */
export async function deliverSalesDocument(id: string) {
  const doc = await prisma.salesDocument.findUnique({ where: { id } });
  if (!doc) throw new Error("Документ не знайдено");
  if (doc.status !== "IN_TRANSIT") throw new Error("Можна доставити тільки відправлений документ");

  await prisma.salesDocument.update({
    where: { id },
    data: { status: "DELIVERED" },
  });
}

/** Cancel document — releases reservations or restores stock depending on status */
export async function cancelSalesDocument(id: string) {
  const doc = await prisma.salesDocument.findUnique({
    where: { id },
    include: { items: true, reservations: true, commissions: true },
  });

  if (!doc) throw new Error("Документ не знайдено");
  if (doc.status === "CANCELLED") throw new Error("Документ вже скасовано");
  if (doc.status === "DELIVERED") throw new Error("Неможливо скасувати доставлений документ");

  const wasDispatched = doc.status === "IN_TRANSIT";

  await prisma.$transaction(async (tx) => {
    if (wasDispatched) {
      // Restore stock (was already deducted)
      for (const item of doc.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }
    } else {
      // Release reservations (stock wasn't deducted yet)
      await tx.stockReservation.deleteMany({ where: { salesDocumentId: id } });
    }

    // Delete commission records if any
    if (doc.commissions.length > 0) {
      await tx.commissionRecord.deleteMany({ where: { salesDocumentId: id } });
    }

    // Remove from delivery route if assigned
    await tx.deliveryStop.deleteMany({ where: { salesDocumentId: id } });

    await tx.salesDocument.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
  });
}

/** Get latest purchase price for a product (from SupplierProduct or Product.wholesalePrice) */
export async function getLatestPurchasePrice(productId: string): Promise<number> {
  const sp = await prisma.supplierProduct.findFirst({
    where: { productId },
    orderBy: { lastUpdated: "desc" },
  });
  if (sp?.purchasePrice) return sp.purchasePrice;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { wholesalePrice: true },
  });
  return product?.wholesalePrice || 0;
}
