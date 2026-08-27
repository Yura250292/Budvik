import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveIdentity } from "@/lib/app/identity";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const me = await resolveIdentity(req);
  if (!me) return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });

  const { id } = await params;

  await prisma.notification.updateMany({
    where: { id, userId: me.userId },
    data: { isRead: true },
  });

  return NextResponse.json({ ok: true });
}
