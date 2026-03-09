import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type"); // SUPPLIER, CUSTOMER, BOTH
  const search = searchParams.get("search");
  const active = searchParams.get("active");

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (active !== null) where.isActive = active !== "false";
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { code: { contains: search, mode: "insensitive" } },
      { contactPerson: { contains: search, mode: "insensitive" } },
    ];
  }

  const counterparties = await prisma.counterparty.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          purchaseOrders: true,
          salesDocuments: true,
          invoices: true,
        },
      },
    },
  });

  return NextResponse.json(counterparties);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { name, code, type, phone, email, address, contactPerson, notes } = body;

  if (!name) {
    return NextResponse.json({ error: "Назва обов'язкова" }, { status: 400 });
  }

  if (code) {
    const existing = await prisma.counterparty.findUnique({ where: { code } });
    if (existing) {
      return NextResponse.json({ error: "Контрагент з таким кодом вже існує" }, { status: 400 });
    }
  }

  const counterparty = await prisma.counterparty.create({
    data: {
      name,
      code: code || null,
      type: type || "BOTH",
      phone: phone || null,
      email: email || null,
      address: address || null,
      contactPerson: contactPerson || null,
      notes: notes || null,
    },
  });

  return NextResponse.json(counterparty, { status: 201 });
}
