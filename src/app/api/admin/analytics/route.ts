import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const repId = searchParams.get("repId");
  const status = searchParams.get("status");

  // Build date filter for SalesDocument
  const dateFilter: Record<string, unknown> = {};
  if (from || to) {
    dateFilter.createdAt = {
      ...(from && { gte: new Date(from) }),
      ...(to && { lte: new Date(to + "T23:59:59") }),
    };
  }

  const statusFilter = status && status !== "ALL" ? { status: status as any } : {};
  const repFilter = repId && repId !== "ALL" ? { salesRepId: repId } : {};

  // 1. All sales documents with details
  const salesDocs: any[] = await prisma.salesDocument.findMany({
    where: { ...dateFilter, ...statusFilter, ...repFilter } as any,
    include: {
      salesRep: { select: { id: true, name: true } },
      counterparty: { select: { id: true, name: true } },
      createdBy: { select: { name: true } },
      items: {
        include: { product: { select: { name: true, sku: true, image: true } } },
      },
      invoice: {
        select: { id: true, paymentStatus: true, totalAmount: true, paidAmount: true, payments: { select: { amount: true, method: true, createdAt: true } } },
      },
      deliveryStop: {
        select: { status: true, deliveredAt: true, deliveryRoute: { select: { number: true, status: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // 2. Summary KPIs
  const allStatuses = ["DRAFT", "CONFIRMED", "PACKING", "IN_TRANSIT", "DELIVERED", "CANCELLED"];
  const statusCounts: Record<string, number> = {};
  for (const s of allStatuses) statusCounts[s] = 0;

  let totalRevenue = 0;
  let totalProfit = 0;
  let totalDiscount = 0;

  for (const doc of salesDocs) {
    statusCounts[doc.status] = (statusCounts[doc.status] || 0) + 1;
    if (doc.status !== "CANCELLED") {
      totalRevenue += doc.totalAmount;
      totalProfit += doc.profitAmount;
      totalDiscount += doc.discountAmount;
    }
  }

  // 3. By sales rep aggregation
  const byRep = new Map<string, { name: string; count: number; revenue: number; profit: number; confirmed: number; delivered: number }>();
  for (const doc of salesDocs) {
    if (!doc.salesRep || doc.status === "CANCELLED") continue;
    const r = byRep.get(doc.salesRep.id) || { name: doc.salesRep.name, count: 0, revenue: 0, profit: 0, confirmed: 0, delivered: 0 };
    r.count++;
    r.revenue += doc.totalAmount;
    r.profit += doc.profitAmount;
    if (doc.status === "CONFIRMED" || doc.status === "PACKING" || doc.status === "IN_TRANSIT" || doc.status === "DELIVERED") r.confirmed++;
    if (doc.status === "DELIVERED") r.delivered++;
    byRep.set(doc.salesRep.id, r);
  }

  // 4. Daily/weekly/monthly aggregation (for turnover chart)
  const dailyMap = new Map<string, { revenue: number; profit: number; count: number }>();
  for (const doc of salesDocs) {
    if (doc.status === "CANCELLED") continue;
    const day = new Date(doc.createdAt).toISOString().slice(0, 10);
    const d = dailyMap.get(day) || { revenue: 0, profit: 0, count: 0 };
    d.revenue += doc.totalAmount;
    d.profit += doc.profitAmount;
    d.count++;
    dailyMap.set(day, d);
  }

  // 5. Payments: cash vs non-cash
  const paymentDateFilter: Record<string, unknown> = {};
  if (from || to) {
    paymentDateFilter.createdAt = {
      ...(from && { gte: new Date(from) }),
      ...(to && { lte: new Date(to + "T23:59:59") }),
    };
  }

  const payments = await prisma.payment.findMany({
    where: paymentDateFilter,
    select: { amount: true, method: true, createdAt: true },
  });

  let cashTotal = 0;
  let bankTotal = 0;
  let otherPayTotal = 0;
  for (const p of payments) {
    const method = (p.method || "").toLowerCase();
    if (method === "cash" || method === "готівка") cashTotal += p.amount;
    else if (method === "bank_transfer" || method === "безготівка" || method === "банк") bankTotal += p.amount;
    else otherPayTotal += p.amount;
  }

  // 6. Bolts analytics
  const boltsDateFilter: Record<string, unknown> = {};
  if (from || to) {
    boltsDateFilter.createdAt = {
      ...(from && { gte: new Date(from) }),
      ...(to && { lte: new Date(to + "T23:59:59") }),
    };
  }

  const boltsEarned = await prisma.boltsTransaction.aggregate({
    where: { type: "EARNED", ...boltsDateFilter },
    _sum: { amount: true },
    _count: true,
  });
  const boltsSpent = await prisma.boltsTransaction.aggregate({
    where: { type: "SPENT", ...boltsDateFilter },
    _sum: { amount: true },
    _count: true,
  });
  const totalBoltsBalance = await prisma.user.aggregate({
    where: { role: "CLIENT" },
    _sum: { boltsBalance: true },
  });

  // 7. Invoices summary (receivables)
  const invoiceSummary = await prisma.invoice.groupBy({
    by: ["paymentStatus"],
    _sum: { totalAmount: true, paidAmount: true },
    _count: true,
  });

  // 8. Commission summary
  const commissionSummary = await prisma.commissionRecord.groupBy({
    by: ["status"],
    where: boltsDateFilter,
    _sum: { commissionAmount: true, saleAmount: true },
    _count: true,
  });

  // 9. Top clients by revenue
  const clientMap = new Map<string, { name: string; revenue: number; count: number; profit: number }>();
  for (const doc of salesDocs) {
    if (!doc.counterparty || doc.status === "CANCELLED") continue;
    const c = clientMap.get(doc.counterparty.id) || { name: doc.counterparty.name, revenue: 0, count: 0, profit: 0 };
    c.revenue += doc.totalAmount;
    c.count++;
    c.profit += doc.profitAmount;
    clientMap.set(doc.counterparty.id, c);
  }

  // 10. Sales reps list for filter
  const salesReps = await prisma.user.findMany({
    where: { role: "SALES" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({
    // Orders list
    orders: salesDocs.map((d) => ({
      id: d.id,
      number: d.number,
      status: d.status,
      totalAmount: d.totalAmount,
      profitAmount: d.profitAmount,
      discountAmount: d.discountAmount,
      deliveryMethod: d.deliveryMethod,
      createdAt: d.createdAt,
      confirmedAt: d.confirmedAt,
      salesRep: d.salesRep,
      counterparty: d.counterparty,
      createdBy: d.createdBy,
      itemCount: d.items.length,
      itemsSummary: d.items.slice(0, 3).map((i: any) => ({ name: i.product.name, qty: i.quantity, price: i.sellingPrice, image: i.product.image })),
      invoiceStatus: d.invoice?.paymentStatus || null,
      paidAmount: d.invoice?.paidAmount || 0,
      deliveryStatus: d.deliveryStop?.status || null,
      routeNumber: d.deliveryStop?.deliveryRoute?.number || null,
    })),

    // KPIs
    kpis: {
      totalOrders: salesDocs.length,
      totalRevenue,
      totalProfit,
      totalDiscount,
      avgOrderValue: salesDocs.length > 0 ? totalRevenue / salesDocs.filter((d) => d.status !== "CANCELLED").length : 0,
      avgMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
    },

    statusCounts,

    // By rep
    byRep: Array.from(byRep.entries())
      .map(([id, data]) => ({ id, ...data, margin: data.revenue > 0 ? Math.round((data.profit / data.revenue) * 1000) / 10 : 0 }))
      .sort((a, b) => b.revenue - a.revenue),

    // Daily turnover
    daily: Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date)),

    // Payments
    payments: {
      cash: cashTotal,
      bank: bankTotal,
      other: otherPayTotal,
      total: cashTotal + bankTotal + otherPayTotal,
    },

    // Bolts
    bolts: {
      earned: boltsEarned._sum.amount || 0,
      earnedCount: boltsEarned._count,
      spent: boltsSpent._sum.amount || 0,
      spentCount: boltsSpent._count,
      totalBalance: totalBoltsBalance._sum.boltsBalance || 0,
    },

    // Invoices
    invoices: invoiceSummary.map((g) => ({
      status: g.paymentStatus,
      count: g._count,
      total: g._sum.totalAmount || 0,
      paid: g._sum.paidAmount || 0,
    })),

    // Commissions
    commissions: commissionSummary.map((g) => ({
      status: g.status,
      count: g._count,
      amount: g._sum.commissionAmount || 0,
      salesAmount: g._sum.saleAmount || 0,
    })),

    // Top clients
    topClients: Array.from(clientMap.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 15),

    // Sales reps for filter
    salesReps,
  });
}
