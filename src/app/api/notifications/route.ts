import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveIdentity } from "@/lib/app/identity";

export async function GET(req: Request) {
  const me = await resolveIdentity(req);
  if (!me) return NextResponse.json({ error: "Потрібно увійти" }, { status: 401 });

  const notifications = await prisma.notification.findMany({
    where: { userId: me.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json(notifications);
}
