/**
 * Оцінка маржі замовлення. Логіка в lib/analytics/order-margin.ts.
 *
 * Доступна і торговому: він мусить бачити маржу саме в момент, коли
 * вирішує дати знижку, — інакше рішення приймається наосліп.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { orderMargin } from "@/lib/analytics/order-margin";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role ?? "";
  if (!["ADMIN", "MANAGER", "SALES"].includes(role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { id } = await params;
  const report = await orderMargin(id);
  if (!report) {
    return NextResponse.json({ error: "Документ не знайдено" }, { status: 404 });
  }

  return NextResponse.json(report);
}
