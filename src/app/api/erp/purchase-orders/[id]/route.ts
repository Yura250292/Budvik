import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const order = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      createdBy: { select: { id: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, price: true, stock: true } },
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
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.purchaseOrder.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
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
