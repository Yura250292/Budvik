import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Record<string, unknown> = {
    salesRepId: session.user.id,
  };

  if (from || to) {
    where.createdAt = {
      ...(from && { gte: new Date(from) }),
      ...(to && { lte: new Date(to + "T23:59:59") }),
    };
  }

  const records = await prisma.commissionRecord.findMany({
    where,
    include: {
      salesDocument: {
        select: { id: true, number: true, counterparty: { select: { name: true } }, confirmedAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Summary
  const totalSales = records.reduce((s, r) => s + r.saleAmount, 0);
  const totalProfit = records.reduce((s, r) => s + r.profitAmount, 0);
  const totalCommission = records.reduce((s, r) => s + r.commissionAmount, 0);
  const pendingCommission = records.filter((r) => r.status === "PENDING").reduce((s, r) => s + r.commissionAmount, 0);
  const paidCommission = records.filter((r) => r.status === "PAID").reduce((s, r) => s + r.commissionAmount, 0);

  return NextResponse.json({
    records,
    summary: { totalSales, totalProfit, totalCommission, pendingCommission, paidCommission },
  });
}
