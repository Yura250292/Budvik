import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const promotions = await prisma.promotion.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json(promotions);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { id, name, description, type, conditions, productIds, categoryIds, isActive, startDate, endDate, sortOrder } = body;

  if (!name || !type || !conditions) {
    return NextResponse.json({ error: "Поля name, type, conditions обов'язкові" }, { status: 400 });
  }

  const data = {
    name,
    description: description || null,
    type,
    conditions,
    productIds: productIds || [],
    categoryIds: categoryIds || [],
    isActive: isActive ?? true,
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    sortOrder: sortOrder ?? 0,
  };

  if (id) {
    const updated = await prisma.promotion.update({ where: { id }, data });
    return NextResponse.json(updated);
  }

  const created = await prisma.promotion.create({ data });
  return NextResponse.json(created, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.promotion.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
