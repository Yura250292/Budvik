import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { include: { product: true } },
      user: { select: { name: true, email: true, phone: true } },
    },
  });

  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (session.user.role === "CLIENT" && order.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(order);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (session.user.role === "CLIENT") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { status } = await req.json();

  const order = await prisma.order.update({
    where: { id },
    data: { status },
    include: { items: { include: { product: true } } },
  });

  // Award bolts when order is delivered
  if (status === "DELIVERED" && order.boltsEarned > 0) {
    await prisma.user.update({
      where: { id: order.userId },
      data: { boltsBalance: { increment: order.boltsEarned } },
    });
    await prisma.boltsTransaction.create({
      data: {
        userId: order.userId,
        amount: order.boltsEarned,
        type: "EARNED",
        orderId: order.id,
        description: `Кешбек ${order.boltsEarned} Болтів за замовлення`,
      },
    });
  }

  return NextResponse.json(order);
}
