import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildTurnoverReport } from "@/lib/analytics/turnover";
import { parseVelocityDays } from "@/lib/analytics/velocity-window";

/**
 * Оборотність складу і неліквіди — зворотний бік звіту закупівель.
 *
 * Живе поруч із /procurement, бо це те саме робоче місце: там «чого бракує»,
 * тут «чого забагато». brandId необов'язковий — без нього огляд по складу.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const report = await buildTurnoverReport(searchParams.get("brandId") || null, {
    velocityDays: parseVelocityDays(searchParams.get("days")),
  });

  return NextResponse.json({ report });
}
