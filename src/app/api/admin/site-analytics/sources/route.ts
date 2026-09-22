/**
 * Звіт «Джерела»: переходи, замовлення й конверсія по майданчиках.
 *
 * Запити живуть у src/lib/webstats/sources.ts — тут лише доступ і розбір
 * періоду, як у сусідньому overview.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parsePeriod } from "@/lib/analytics/period";
import { parseView } from "@/lib/webstats/people";
import { sourceReport } from "@/lib/webstats/sources";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const period = parsePeriod(params);
  const view = parseView(params);
  const data = await sourceReport(period.from, period.to, view);

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    view,
    ...data,
  });
}
