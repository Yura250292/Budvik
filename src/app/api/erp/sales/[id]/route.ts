import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES", "WAREHOUSE", "DRIVER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const doc = await prisma.salesDocument.findUnique({
    where: { id },
    include: {
      counterparty: true,
      salesRep: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, price: true, stock: true, image: true } },
        },
      },
      commissions: true,
      deliveryStop: {
        include: { deliveryRoute: { select: { id: true, number: true, date: true, driver: { select: { name: true } } } } },
      },
    },
  });

  if (!doc) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }

  // SALES can only see their own
  if (session.user.role === "SALES" && doc.salesRepId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(doc);
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
  const existing = await prisma.salesDocument.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }
  if (existing.status !== "DRAFT") {
    return NextResponse.json({ error: "Можна редагувати тільки чернетку" }, { status: 400 });
  }

  const body = await req.json();
  const { counterpartyId, salesRepId, items, notes } = body;

  const updateData: Record<string, unknown> = {};
  if (counterpartyId !== undefined) updateData.counterpartyId = counterpartyId || null;
  if (salesRepId !== undefined) updateData.salesRepId = salesRepId;
  if (notes !== undefined) updateData.notes = notes || null;

  if (items && Array.isArray(items)) {
    await prisma.salesDocumentItem.deleteMany({ where: { salesDocumentId: id } });
    await prisma.salesDocumentItem.createMany({
      data: items.map((item: { productId: string; quantity: number; sellingPrice: number; purchasePrice: number; discountPercent?: number }) => ({
        salesDocumentId: id,
        productId: item.productId,
        quantity: item.quantity,
        sellingPrice: item.sellingPrice,
        purchasePrice: item.purchasePrice,
        discountPercent: item.discountPercent || 0,
      })),
    });
    updateData.totalAmount = items.reduce(
      (sum: number, item: { quantity: number; sellingPrice: number }) =>
        sum + item.quantity * item.sellingPrice,
      0
    );
  }

  const doc = await prisma.salesDocument.update({
    where: { id },
    data: updateData,
    include: {
      counterparty: true,
      salesRep: { select: { id: true, name: true } },
      items: {
        include: { product: { select: { id: true, name: true, sku: true } } },
      },
    },
  });

  return NextResponse.json(doc);
}
