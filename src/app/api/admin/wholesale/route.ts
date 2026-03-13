import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const applications = await prisma.wholesaleApplication.findMany({
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      company: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(applications);
}
