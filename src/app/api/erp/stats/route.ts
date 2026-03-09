import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSalesStats, getPurchaseStats } from "@/lib/erp/stats";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "SALES"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;

  const [sales, purchases] = await Promise.all([
    getSalesStats(from, to),
    getPurchaseStats(from, to),
  ]);

  return NextResponse.json({ sales, purchases });
}
