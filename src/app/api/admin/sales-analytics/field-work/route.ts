/**
 * Звіт «Польова робота»: чи торгові уточнюють карту клієнтів.
 *
 * Окремий маршрут, а не колонка в аналітиці торгових, бо міряє інше: не
 * продажі, а знання про клієнта, яке з'являється лише коли людина фізично
 * стоїть біля дверей магазину. Період фільтрує самі дії, покриття бази й
 * залишок роботи рахуються завжди на «зараз» — це стан, а не оборот.
 *
 * Доступ лише керівництву. Торговому свої цифри й так видно в кабінеті, а
 * порівняння себе з колегами тут перетворило б робочий звіт на табло.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parsePeriod } from "@/lib/analytics/period";
import { fieldEvents, fieldWorkers, geoCoverage, repGeoBacklog } from "@/lib/analytics/field-work";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = new Set(["ADMIN", "MANAGER"]);

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!FULL_ACCESS_ROLES.has(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const url = new URL(req.url);
  const period = parsePeriod(url.searchParams);

  const [coverage, workers, backlog, events] = await Promise.all([
    geoCoverage(),
    fieldWorkers(period),
    repGeoBacklog(),
    fieldEvents(period),
  ]);

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    coverage,
    workers,
    backlog,
    events,
  });
}
