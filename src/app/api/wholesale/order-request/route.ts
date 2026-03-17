import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getNextDocumentNumber } from "@/lib/erp/document-numbers";
import { getLatestPurchasePrice } from "@/lib/erp/sales";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "WHOLESALE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { items, notes } = body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Додайте товари до кошика" }, { status: 400 });
  }

  // Find user's linked counterparty and assigned sales rep
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, counterpartyId: true },
  });

  let salesRepId: string | null = null;

  if (user?.counterpartyId) {
    const salesRepClient = await prisma.salesRepClient.findFirst({
      where: { counterpartyId: user.counterpartyId },
      select: { salesRepId: true },
    });
    salesRepId = salesRepClient?.salesRepId ?? null;
  }

  // If no sales rep found, try to find any SALES user as fallback
  if (!salesRepId) {
    const anySalesRep = await prisma.user.findFirst({
      where: { role: "SALES" },
      select: { id: true },
    });
    salesRepId = anySalesRep?.id ?? null;
  }

  const number = await getNextDocumentNumber("SD");

  // Resolve purchase prices
  const processedItems = await Promise.all(
    items.map(async (item: { productId: string; quantity: number; sellingPrice: number }) => ({
      productId: item.productId,
      quantity: item.quantity,
      sellingPrice: item.sellingPrice,
      purchasePrice: await getLatestPurchasePrice(item.productId),
      discountPercent: 0,
    }))
  );

  const totalAmount = processedItems.reduce(
    (sum, item) => sum + item.quantity * item.sellingPrice,
    0
  );

  const doc = await prisma.$transaction(async (tx) => {
    // Check stock availability
    for (const item of processedItems) {
      const product = await tx.product.findUnique({
        where: { id: item.productId },
        select: { name: true, stock: true },
      });
      if (!product) throw new Error(`Товар не знайдено: ${item.productId}`);

      const reserved = await tx.stockReservation.aggregate({
        where: { productId: item.productId },
        _sum: { quantity: true },
      });
      const available = product.stock - (reserved._sum.quantity || 0);
      if (available < item.quantity) {
        throw new Error(
          `Недостатньо товару "${product.name}" (доступно: ${available})`
        );
      }
    }

    const created = await tx.salesDocument.create({
      data: {
        number,
        counterpartyId: user?.counterpartyId ?? null,
        salesRepId,
        totalAmount,
        notes: notes || null,
        createdById: session.user.id,
        items: { create: processedItems },
      },
    });

    // Reserve stock
    await tx.stockReservation.createMany({
      data: processedItems.map((item) => ({
        productId: item.productId,
        salesDocumentId: created.id,
        quantity: item.quantity,
      })),
    });

    // Notify the assigned sales rep
    if (salesRepId) {
      await tx.notification.create({
        data: {
          userId: salesRepId,
          type: "WHOLESALE_ORDER_REQUEST",
          title: "Новий запит від оптового клієнта",
          body: `${user?.name ?? "Клієнт"} надіслав замовлення №${number} на суму ${totalAmount.toLocaleString("uk-UA", { style: "currency", currency: "UAH" })}`,
          relatedId: created.id,
        },
      });
    }

    return created;
  });

  return NextResponse.json({ id: doc.id, number: doc.number }, { status: 201 });
}
