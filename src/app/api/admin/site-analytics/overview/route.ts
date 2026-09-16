/**
 * Зведення вебаналітики: KPI, динаміка по днях і розрізи відвідувачів.
 *
 * Самі запити живуть у src/lib/webstats/traffic.ts: ті самі числа читає
 * помічник керівника, і друга реалізація неминуче розійшлася б із цією.
 * Тут лишається доступ і розбір періоду.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parsePeriod } from "@/lib/analytics/period";
import { siteOverview } from "@/lib/webstats/traffic";
import { parseView, HUMAN_SIGNALS_SINCE_DAY } from "@/lib/webstats/people";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const period = parsePeriod(params);
  const view = parseView(params);
  const data = await siteOverview(period.from, period.to, view);

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    view,
    humanSignalsSince: HUMAN_SIGNALS_SINCE_DAY,
    ...data,
  });
}
