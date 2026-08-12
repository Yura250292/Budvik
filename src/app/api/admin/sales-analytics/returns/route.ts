/**
 * Повернення товару від покупців: хто, коли, що і на скільки.
 *
 * Окремий маршрут, а не колонка в загальній аналітиці, бо питання інші:
 * там «скільки продали», тут «що до нас поїхало назад». Джерело те саме —
 * документи ВозвратТоваровОтПокупателя з 1С (docType RETURN).
 *
 * Суми звідси приходять ДОДАТНІ, хоча в базі лежать від'ємні: мінус
 * потрібен, щоб SUM() віднімав повернення з обороту сам, а в таблиці він
 * лише заважає — знак несе назва колонки. Розворот робиться в facts.ts.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod } from "@/lib/analytics/period";
import { returnDocs, returnsByClient, returnedProducts, revenueByRep } from "@/lib/analytics/facts";

export const dynamic = "force-dynamic";

/** Ролі, яким видно чужі повернення. Торговий бачить лише свої. */
const FULL_ACCESS_ROLES = new Set(["ADMIN", "MANAGER"]);

/** Стеля списку документів: більше на одному екрані все одно не читають. */
const DOCS_LIMIT = 300;

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
  const period = parsePeriod(url.searchParams);
  const repFilter = url.searchParams.get("rep");

  // Торговий бачить лише свої повернення, що б не стояло в параметрах.
  const restrictToRep = isFullAccess ? repFilter : (userId ?? null);

  const [docs, byClient, byProduct, revenue, reps] = await Promise.all([
    returnDocs(period.from, period.to, restrictToRep, DOCS_LIMIT),
    returnsByClient(period.from, period.to, restrictToRep),
    returnedProducts(period.from, period.to, restrictToRep),
    revenueByRep(period.from, period.to, restrictToRep),
    prisma.user.findMany({ where: { role: "SALES" }, select: { id: true, name: true } }),
  ]);

  const nameById = new Map(reps.map((r) => [r.id, r.name ?? "—"]));

  // Підсумки рахуємо з revenueByRep, а не з обрізаного списку документів:
  // при 300+ поверненнях сума за списком була б меншою за справжню.
  const returns = revenue.reduce((sum, r) => sum + r.returns, 0);
  const netto = revenue.reduce((sum, r) => sum + r.amount, 0);
  const gross = netto + returns;

  const byRep = revenue
    .filter((r) => r.returns > 0)
    .map((r) => ({
      repId: r.repId,
      name: nameById.get(r.repId) ?? "—",
      amount: r.returns,
      revenue: r.amount,
      ratio: r.amount + r.returns > 0 ? (r.returns / (r.amount + r.returns)) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    totals: {
      amount: returns,
      docs: docs.length,
      /** Оборот до вирахування повернень — база для частки. */
      gross,
      ratio: gross > 0 ? (returns / gross) * 100 : 0,
      /** Чи впав список під стелю: інтерфейс має про це попередити. */
      truncated: docs.length >= DOCS_LIMIT,
    },
    docs,
    byClient,
    byProduct,
    byRep,
  });
}
