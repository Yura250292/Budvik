import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      counterparty: true,
      salesDocument: {
        include: {
          items: {
            include: { product: { select: { id: true, name: true, sku: true } } },
          },
        },
      },
      createdBy: { select: { id: true, name: true } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }

  return NextResponse.json(invoice);
}
