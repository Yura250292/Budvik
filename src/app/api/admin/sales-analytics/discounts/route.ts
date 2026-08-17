/**
 * Знижки: скільки маржі віддано і кому. Логіка в lib/analytics/discounts.ts.
 *
 * Лише керівництву: це матеріал для розмови з торговим про його ціни, а не
 * робочий список.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parsePeriod } from "@/lib/analytics/period";
import { buildDiscountReport } from "@/lib/analytics/discounts";

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

  // Типово 90 днів: на коротшому вікні медіанні ціни спираються на мало
  // продажів, і «звичайна ціна» перестає бути звичайною.
  const period = parsePeriod(new URL(req.url).searchParams, 90);
  const report = await buildDiscountReport(period.from, period.to);

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, clamped: period.clamped },
    ...report,
  });
}
