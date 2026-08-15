/**
 * Платіжна дисципліна клієнтів. Логіка в lib/analytics/discipline.ts.
 *
 * Періоду навмисно немає: борг — залишок «на зараз», швидкість — фіксоване
 * вікно. Лише керівництво: це рішення про кредитні ліміти, а не робочий
 * список торгового.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildDisciplineReport } from "@/lib/analytics/discipline";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role ?? "";
  if (!["ADMIN", "MANAGER"].includes(role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  return NextResponse.json(await buildDisciplineReport());
}
