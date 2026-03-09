import { prisma } from "@/lib/prisma";
import { extractBrand } from "@/lib/wholesale-pricing";

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

    // Decrement stock for each item
    for (const item of doc.items) {
      if (item.product.stock < item.quantity) {
        throw new Error(`Недостатньо товару "${item.product.name}" (залишок: ${item.product.stock})`);
      }

      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { decrement: item.quantity } },
      });

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

      // Look up commission rate for this sales rep + brand
      const rate = await tx.commissionRate.findUnique({
        where: {
          salesRepId_brand: {
            salesRepId: doc.salesRepId!,
            brand,
          },
        },
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

    // Update document
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

export async function cancelSalesDocument(id: string) {
  const doc = await prisma.salesDocument.findUnique({
    where: { id },
    include: { items: true, commissions: true },
  });

  if (!doc) throw new Error("Документ не знайдено");
  if (doc.status === "CANCELLED") throw new Error("Документ вже скасовано");

  const wasConfirmed = doc.status === "CONFIRMED";

  await prisma.$transaction(async (tx) => {
    if (wasConfirmed) {
      // Restore stock
      for (const item of doc.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
      }

      // Delete commission records
      await tx.commissionRecord.deleteMany({
        where: { salesDocumentId: id },
      });
    }

    await tx.salesDocument.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
  });
}

/** Get latest purchase price for a product (from any supplier) */
export async function getLatestPurchasePrice(productId: string): Promise<number> {
  const sp = await prisma.supplierProduct.findFirst({
    where: { productId },
    orderBy: { lastUpdated: "desc" },
  });
  return sp?.purchasePrice || 0;
}
