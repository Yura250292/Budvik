import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      boltsBalance: true,
      createdAt: true,
      updatedAt: true,
      orders: {
        include: {
          items: { include: { product: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      boltsTransactions: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const totalSpent = user.orders.reduce((sum, o) => sum + o.totalAmount, 0);
  const totalOrders = user.orders.length;
  const activeOrders = user.orders.filter(
    (o) => !["DELIVERED", "CANCELLED"].includes(o.status)
  ).length;

  return NextResponse.json({
    ...user,
    totalSpent,
    totalOrders,
    activeOrders,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { role } = await req.json();

  if (!["CLIENT", "SALES"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  // Prevent changing own role
  if (id === session.user.id) {
    return NextResponse.json({ error: "Cannot change own role" }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id },
    data: { role },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  });

  return NextResponse.json(user);
}
