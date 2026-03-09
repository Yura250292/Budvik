import { prisma } from "@/lib/prisma";

export async function confirmPurchaseOrder(id: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!po) throw new Error("Документ не знайдено");
  if (po.status !== "DRAFT") throw new Error("Можна підтвердити тільки чернетку");

  await prisma.$transaction(async (tx) => {
    // Update stock for each item
    for (const item of po.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });

      // Upsert supplier product with latest purchase price
      await tx.supplierProduct.upsert({
        where: {
          supplierId_productId: {
            supplierId: po.supplierId,
            productId: item.productId,
          },
        },
        update: {
          purchasePrice: item.purchasePrice,
          lastUpdated: new Date(),
        },
        create: {
          supplierId: po.supplierId,
          productId: item.productId,
          purchasePrice: item.purchasePrice,
        },
      });
    }

    // Update PO status
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
  });
}

export async function cancelPurchaseOrder(id: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!po) throw new Error("Документ не знайдено");
  if (po.status === "CANCELLED") throw new Error("Документ вже скасовано");

  const wasConfirmed = po.status === "CONFIRMED";

  await prisma.$transaction(async (tx) => {
    // Reverse stock if was confirmed
    if (wasConfirmed) {
      for (const item of po.items) {
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
      }
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
  });
}
