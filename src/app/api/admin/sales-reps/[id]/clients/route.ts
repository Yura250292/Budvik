import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const clients = await prisma.salesRepClient.findMany({
    where: { salesRepId: id },
    include: { counterparty: { select: { id: true, name: true, address: true, phone: true } } },
    orderBy: { counterparty: { name: "asc" } },
  });
  return NextResponse.json(clients);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const { counterpartyId } = await req.json();
  if (!counterpartyId) return NextResponse.json({ error: "Оберіть клієнта" }, { status: 400 });

  const created = await prisma.salesRepClient.create({
    data: { salesRepId: id, counterpartyId },
    include: { counterparty: { select: { id: true, name: true, address: true } } },
  });
  return NextResponse.json(created, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const { assignmentId } = await req.json();
  await prisma.salesRepClient.delete({ where: { id: assignmentId, salesRepId: id } });
  return NextResponse.json({ ok: true });
}
