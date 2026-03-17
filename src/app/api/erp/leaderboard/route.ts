import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = searchParams.get("period") || "month"; // month | quarter | year | all

  // Calculate date range
  const now = new Date();
  let from: Date | undefined;
  if (period === "month") {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (period === "quarter") {
    const q = Math.floor(now.getMonth() / 3) * 3;
    from = new Date(now.getFullYear(), q, 1);
  } else if (period === "year") {
    from = new Date(now.getFullYear(), 0, 1);
  }

  const where: Record<string, unknown> = {};
  if (from) {
    where.createdAt = { gte: from };
  }

  // Get all confirmed sales documents with items
  const salesDocs = await prisma.salesDocument.findMany({
    where: {
      status: { in: ["CONFIRMED", "DELIVERED"] },
      ...(from && { confirmedAt: { gte: from } }),
    },
    include: {
      salesRep: { select: { id: true, name: true } },
      items: { select: { quantity: true, sellingPrice: true } },
      counterparty: { select: { name: true } },
    },
  });

  // Aggregate per sales rep
  const repMap = new Map<string, {
    id: string;
    name: string;
    turnover: number;
    quantity: number;
    docs: number;
    clients: Set<string>;
  }>();

  for (const doc of salesDocs) {
    if (!doc.salesRepId || !doc.salesRep) continue;
    const rep = repMap.get(doc.salesRepId) || {
      id: doc.salesRepId,
      name: doc.salesRep.name,
      turnover: 0,
      quantity: 0,
      docs: 0,
      clients: new Set<string>(),
    };
    rep.docs += 1;
    if (doc.counterpartyId) rep.clients.add(doc.counterpartyId);
    for (const item of doc.items) {
      rep.turnover += item.quantity * item.sellingPrice;
      rep.quantity += item.quantity;
    }
    repMap.set(doc.salesRepId, rep);
  }

  // Get commission data
  const commissions = await prisma.commissionRecord.groupBy({
    by: ["salesRepId"],
    where: from ? { createdAt: { gte: from } } : undefined,
    _sum: { commissionAmount: true },
  });
  const commMap = new Map(commissions.map((c) => [c.salesRepId, c._sum.commissionAmount || 0]));

  // Build leaderboard arrays
  const reps = Array.from(repMap.values()).map((r) => ({
    id: r.id,
    name: r.name,
    turnover: Math.round(r.turnover * 100) / 100,
    quantity: r.quantity,
    docs: r.docs,
    clients: r.clients.size,
    commission: commMap.get(r.id) || 0,
  }));

  // Sort by different criteria
  const byTurnover = [...reps].sort((a, b) => b.turnover - a.turnover);
  const byQuantity = [...reps].sort((a, b) => b.quantity - a.quantity);
  const byDocs = [...reps].sort((a, b) => b.docs - a.docs);
  const byClients = [...reps].sort((a, b) => b.clients - a.clients);

  // Current user stats for SALES role
  const myStats = reps.find((r) => r.id === session.user.id);
  const myRankTurnover = byTurnover.findIndex((r) => r.id === session.user.id) + 1;
  const myRankQuantity = byQuantity.findIndex((r) => r.id === session.user.id) + 1;

  return NextResponse.json({
    leaderboard: { byTurnover, byQuantity, byDocs, byClients },
    myStats: myStats || null,
    myRank: { turnover: myRankTurnover || null, quantity: myRankQuantity || null },
    totalReps: reps.length,
    period,
  });
}
