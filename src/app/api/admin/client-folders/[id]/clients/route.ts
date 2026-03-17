import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { counterpartyId, counterpartyIds } = await req.json();

  // Support both single and bulk add
  const ids = counterpartyIds || (counterpartyId ? [counterpartyId] : []);
  if (ids.length === 0) return NextResponse.json({ error: "Вкажіть клієнтів" }, { status: 400 });

  // Skip duplicates
  const existing = await prisma.clientFolderItem.findMany({
    where: { folderId: id, counterpartyId: { in: ids } },
    select: { counterpartyId: true },
  });
  const existingIds = new Set(existing.map((e) => e.counterpartyId));
  const newIds = ids.filter((cid: string) => !existingIds.has(cid));

  if (newIds.length > 0) {
    await prisma.clientFolderItem.createMany({
      data: newIds.map((cid: string) => ({ folderId: id, counterpartyId: cid })),
    });
  }

  return NextResponse.json({ ok: true, added: newIds.length, skipped: ids.length - newIds.length });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { itemId, counterpartyId } = await req.json();

  if (itemId) {
    await prisma.clientFolderItem.delete({ where: { id: itemId } });
  } else if (counterpartyId) {
    await prisma.clientFolderItem.deleteMany({ where: { folderId: id, counterpartyId } });
  }

  return NextResponse.json({ ok: true });
}
