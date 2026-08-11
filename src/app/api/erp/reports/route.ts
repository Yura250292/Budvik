import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAccountingReport } from "@/lib/erp/accounting";
import { parsePeriod } from "@/lib/analytics/period";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // parsePeriod, а не сирі from/to: київські межі доби й ті самі правила,
  // що в аналітиці торгових, інакше «серпень» тут і там давав би різні суми.
  const { searchParams } = new URL(req.url);
  const period = parsePeriod(searchParams);

  const report = await getAccountingReport(period);
  return NextResponse.json(report);
}
