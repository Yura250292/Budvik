import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Bulk assign clients from a folder to a sales rep
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: salesRepId } = await params;
  const { folderId } = await req.json();

  if (!folderId) return NextResponse.json({ error: "Вкажіть папку" }, { status: 400 });

  // Get folder items
  const folderItems = await prisma.clientFolderItem.findMany({
    where: { folderId },
    select: { counterpartyId: true },
  });

  if (folderItems.length === 0) {
    return NextResponse.json({ error: "Папка порожня" }, { status: 400 });
  }

  const counterpartyIds = folderItems.map((i) => i.counterpartyId);

  // Check which are already assigned
  const existing = await prisma.salesRepClient.findMany({
    where: { salesRepId, counterpartyId: { in: counterpartyIds } },
    select: { counterpartyId: true },
  });
  const existingIds = new Set(existing.map((e) => e.counterpartyId));
  const newIds = counterpartyIds.filter((cid) => !existingIds.has(cid));

  if (newIds.length > 0) {
    await prisma.salesRepClient.createMany({
      data: newIds.map((counterpartyId) => ({ salesRepId, counterpartyId })),
    });
  }

  return NextResponse.json({
    ok: true,
    total: counterpartyIds.length,
    added: newIds.length,
    skipped: counterpartyIds.length - newIds.length,
  });
}
