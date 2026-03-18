import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const jobs = await prisma.syncJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { _count: { select: { discrepancies: true } } },
  });

  return NextResponse.json(jobs);
}
