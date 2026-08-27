import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveIdentity } from "@/lib/app/identity";

export async function PATCH(req: Request) {
  const me = await resolveIdentity(req);
  if (!me) return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });

  await prisma.notification.updateMany({
    where: { userId: me.userId, isRead: false },
    data: { isRead: true },
  });

  return NextResponse.json({ ok: true });
}
