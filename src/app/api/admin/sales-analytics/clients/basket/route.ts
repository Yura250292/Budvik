/**
 * Кошик: пари товарів, які їдуть в одній накладній.
 * Логіка в lib/analytics/basket.ts.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parsePeriod } from "@/lib/analytics/period";
import { buildBasketReport } from "@/lib/analytics/basket";

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

  // Типово пів року: на короткому вікні пари не встигають набрати
  // MIN_TOGETHER збігів і звіт виходить порожнім.
  const period = parsePeriod(new URL(req.url).searchParams, 180);
  const report = await buildBasketReport(period.from, period.to);

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay },
    ...report,
  });
}
