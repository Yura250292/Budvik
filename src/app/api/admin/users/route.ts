import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      boltsBalance: true,
      createdAt: true,
      _count: { select: { orders: true } },
      orders: {
        select: { totalAmount: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const result = users.map((u) => ({
    ...u,
    totalSpent: u.orders.reduce((sum, o) => sum + o.totalAmount, 0),
    orders: undefined,
  }));

  return NextResponse.json(result);
}
