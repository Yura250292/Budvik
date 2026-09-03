import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, OFFICE_ROLES } from "@/lib/app/identity";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      stockLocation: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      // Порядок рядків — той, що набрали в 1С: торговий і закупівельник
      // звіряють нашу картку з екраном 1С поруч, і переставлені позиції
      // читаються як інші дані. Рядки без номера (набрані на сайті або
      // приїхали до появи lineNo) сортуються за назвою після них.
      items: {
        orderBy: [{ lineNo: { sort: "asc", nulls: "last" } }, { product: { name: "asc" } }],
        include: {
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              slug: true,
              price: true,
              stock: true,
              image: true,
              brand: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  if (!order) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }

  return NextResponse.json(order);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }
  // Документ з 1С правиться в 1С. Локальна правка не «нічого не зламає»:
  // наступний цикл обміну перезапише її, і між цим сайт показуватиме те,
  // чого в обліку немає.
  if (existing.externalId) {
    return NextResponse.json(
      { error: "Документ із 1С редагується лише в 1С" },
      { status: 409 }
    );
  }
  if (existing.status !== "DRAFT") {
    return NextResponse.json({ error: "Можна редагувати тільки чернетку" }, { status: 400 });
  }

  const body = await req.json();
  const { supplierId, items, notes } = body;

  const updateData: Record<string, unknown> = {};
  if (supplierId) updateData.supplierId = supplierId;
  if (notes !== undefined) updateData.notes = notes || null;

  if (items && Array.isArray(items)) {
    // Delete old items and create new ones
    await prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
    await prisma.purchaseOrderItem.createMany({
      data: items.map((item: { productId: string; quantity: number; purchasePrice: number }) => ({
        purchaseOrderId: id,
        productId: item.productId,
        quantity: item.quantity,
        purchasePrice: item.purchasePrice,
      })),
    });
    updateData.totalAmount = items.reduce(
      (sum: number, item: { quantity: number; purchasePrice: number }) =>
        sum + item.quantity * item.purchasePrice,
      0
    );
  }

  const order = await prisma.purchaseOrder.update({
    where: { id },
    data: updateData,
    include: {
      supplier: true,
      items: {
        include: { product: { select: { id: true, name: true, sku: true } } },
      },
    },
  });

  return NextResponse.json(order);
}
