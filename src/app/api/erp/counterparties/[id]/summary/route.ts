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

  const counterparty = await prisma.counterparty.findUnique({
    where: { id },
    select: { id: true, name: true, code: true, type: true, phone: true, email: true, address: true, contactPerson: true },
  });

  if (!counterparty) {
    return NextResponse.json({ error: "Не знайдено" }, { status: 404 });
  }

  // Unpaid invoices (debt)
  const invoices = await prisma.invoice.findMany({
    where: { counterpartyId: id, paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
    select: { id: true, number: true, totalAmount: true, paidAmount: true, paymentStatus: true, dueDate: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const totalDebt = invoices.reduce((sum, inv) => sum + (inv.totalAmount - inv.paidAmount), 0);

  // Recent sales documents
  const whereDoc: Record<string, unknown> = { counterpartyId: id };
  if (session.user.role === "SALES") {
    whereDoc.salesRepId = session.user.id;
  }

  const recentSales = await prisma.salesDocument.findMany({
    where: whereDoc,
    select: {
      id: true, number: true, status: true, totalAmount: true, profitAmount: true, createdAt: true,
      salesRep: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  // Stats
  const confirmedSales = recentSales.filter((s) => s.status === "CONFIRMED");
  const totalSalesAmount = confirmedSales.reduce((sum, s) => sum + s.totalAmount, 0);

  return NextResponse.json({
    counterparty,
    debt: { total: totalDebt, invoices },
    sales: { items: recentSales, totalAmount: totalSalesAmount, count: confirmedSales.length },
  });
}
