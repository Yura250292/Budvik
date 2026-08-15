/**
 * Географія обороту по містах. Логіка в lib/analytics/geo-revenue.ts.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parsePeriod } from "@/lib/analytics/period";
import { buildGeoRevenueReport } from "@/lib/analytics/geo-revenue";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role ?? "";
  if (!["ADMIN", "MANAGER"].includes(role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const period = parsePeriod(new URL(req.url).searchParams, 180);
  const report = await buildGeoRevenueReport(period.from, period.to);

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay },
    ...report,
  });
}
