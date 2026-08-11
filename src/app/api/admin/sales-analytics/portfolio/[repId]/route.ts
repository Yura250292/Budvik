/**
 * Портфель клієнтів торгового + динаміка обороту.
 *
 * Одна відповідь на два блоки картки: обидва про те саме — як змінюється
 * робота торгового в часі, — і мусять бути за той самий період. Окремими
 * запитами вони колись розійшлися б на межі доби.
 *
 * LLM тут не бере участі: це чисті факти, які цінні самі по собі.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod } from "@/lib/analytics/period";
import { clientPortfolio } from "@/lib/analytics/clients";
import { repTrend } from "@/lib/analytics/trends";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ repId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const { repId } = await params;
  const role = session.user.role;
  const isFullAccess = FULL_ACCESS_ROLES.includes(role);

  // Торговий може дивитися лише власний портфель.
  if (!isFullAccess && (role !== "SALES" || session.user.id !== repId)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const rep = await prisma.user.findUnique({
    where: { id: repId },
    select: { id: true, name: true },
  });
  if (!rep) {
    return NextResponse.json({ error: "Торгового не знайдено" }, { status: 404 });
  }

  const period = parsePeriod(new URL(req.url).searchParams);

  const [portfolio, trend] = await Promise.all([
    clientPortfolio(repId, period),
    repTrend(repId, period),
  ]);

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    rep,
    portfolio,
    trend,
  });
}
