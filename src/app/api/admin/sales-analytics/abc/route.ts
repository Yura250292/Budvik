/**
 * ABC/XYZ-аналіз: внесок в оборот × передбачуваність попиту.
 *
 * Логіка живе в lib/analytics/abc.ts — тут лише доступ, розбір параметрів
 * і межа видимості: торговий бачить власний зріз, керівництво — компанію.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parsePeriod } from "@/lib/analytics/period";
import { buildAbcReport, type AbcBasis, type AbcDimension } from "@/lib/analytics/abc";

export const dynamic = "force-dynamic";

/** Ролі, яким видно зріз по всій компанії. */
const FULL_ACCESS_ROLES = new Set(["ADMIN", "MANAGER"]);

const DIMENSIONS = new Set<AbcDimension>(["product", "brand", "client"]);

/** Стеля списку: далі за п'ятсот рядків очима все одно не читають. */
const ROWS_LIMIT = 500;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const role = (session.user as { role?: string }).role ?? "CLIENT";
  const userId = (session.user as { id?: string }).id;
  const isFullAccess = FULL_ACCESS_ROLES.has(role);

  if (!isFullAccess && role !== "SALES") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const url = new URL(req.url);
  // Типово 180 днів: XYZ вимагає щонайменше трьох місяців, а типовий для
  // решти вкладок місячний період віддав би самі прочерки замість класів.
  const period = parsePeriod(url.searchParams, 180);
  const repFilter = url.searchParams.get("rep");

  const dimParam = url.searchParams.get("dimension") as AbcDimension | null;
  const dimension: AbcDimension = dimParam && DIMENSIONS.has(dimParam) ? dimParam : "product";

  // Оборот за замовчуванням: класи за прибутком мають сенс лише там, де
  // приїхала собівартість, а це залежить від періоду.
  const basisParam = url.searchParams.get("basis");
  const basis: AbcBasis = basisParam === "profit" ? "profit" : "amount";

  // Торговий бачить лише власні продажі, що б не стояло в параметрах.
  const restrictToRep = isFullAccess ? repFilter : (userId ?? null);

  const report = await buildAbcReport(period.from, period.to, dimension, restrictToRep, ROWS_LIMIT, basis);

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, days: period.days, clamped: period.clamped },
    ...report,
    truncated: report.rows.length >= ROWS_LIMIT,
  });
}
