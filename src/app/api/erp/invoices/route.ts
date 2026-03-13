import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getNextDocumentNumber } from "@/lib/erp/document-numbers";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const paymentStatus = searchParams.get("paymentStatus");

  const where: Record<string, unknown> = {};
  if (paymentStatus) where.paymentStatus = paymentStatus;

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      counterparty: { select: { id: true, name: true } },
      salesDocument: { select: { id: true, number: true } },
      createdBy: { select: { id: true, name: true } },
      _count: { select: { payments: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(invoices);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { counterpartyId, salesDocumentId, totalAmount, dueDate, notes } = body;

  if (!counterpartyId || !totalAmount) {
    return NextResponse.json({ error: "Контрагент та сума обов'язкові" }, { status: 400 });
  }

  const number = await getNextDocumentNumber("INV");

  const invoice = await prisma.invoice.create({
    data: {
      number,
      counterpartyId,
      salesDocumentId: salesDocumentId || null,
      totalAmount,
      dueDate: dueDate ? new Date(dueDate) : null,
      notes: notes || null,
      createdById: session.user.id,
    },
    include: {
      counterparty: true,
      salesDocument: { select: { id: true, number: true } },
    },
  });

  return NextResponse.json(invoice, { status: 201 });
}
