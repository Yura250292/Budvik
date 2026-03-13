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
  const counterparty = await prisma.counterparty.findUnique({
    where: { id },
    include: {
      supplierProducts: {
        include: { product: { select: { id: true, name: true, sku: true, price: true } } },
      },
      _count: {
        select: {
          purchaseOrders: true,
          salesDocuments: true,
          invoices: true,
        },
      },
    },
  });

  if (!counterparty) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }

  return NextResponse.json(counterparty);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { name, code, type, phone, email, address, contactPerson, notes, isActive } = body;

  if (code) {
    const existing = await prisma.counterparty.findUnique({ where: { code } });
    if (existing && existing.id !== id) {
      return NextResponse.json({ error: "Контрагент з таким кодом вже існує" }, { status: 400 });
    }
  }

  const counterparty = await prisma.counterparty.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(code !== undefined && { code: code || null }),
      ...(type !== undefined && { type }),
      ...(phone !== undefined && { phone: phone || null }),
      ...(email !== undefined && { email: email || null }),
      ...(address !== undefined && { address: address || null }),
      ...(contactPerson !== undefined && { contactPerson: contactPerson || null }),
      ...(notes !== undefined && { notes: notes || null }),
      ...(isActive !== undefined && { isActive }),
    },
  });

  return NextResponse.json(counterparty);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Check if counterparty has any documents
  const counts = await prisma.counterparty.findUnique({
    where: { id },
    include: {
      _count: {
        select: { purchaseOrders: true, salesDocuments: true, invoices: true },
      },
    },
  });

  if (!counts) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }

  const total = counts._count.purchaseOrders + counts._count.salesDocuments + counts._count.invoices;
  if (total > 0) {
    return NextResponse.json(
      { error: "Неможливо видалити контрагента з документами. Деактивуйте замість цього." },
      { status: 400 }
    );
  }

  await prisma.counterparty.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
