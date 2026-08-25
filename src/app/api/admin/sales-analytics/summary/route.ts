/**
 * Зведена по торгових: усі залежності в одному рядку.
 *
 * Оборот, виконання плану, паливо, зібрані кошти, дебіторка і заробіток
 * рахуються тут разом — на фронті нічого не зшивається. Вкладка «Торгові»
 * колись зводила три ендпоінти клієнтом, і кожен новий показник вимагав
 * ще одного запиту та ще одного місця, де числа могли розійтися.
 *
 * Три різні часові рамки в одній відповіді, і це свідомо:
 *   • оборот, паливо, зібране — за обраний період;
 *   • виконання плану — за календарний місяць дати «до» (план місячний);
 *   • дебіторка — станом на зараз (це залишок, не потік).
 * UI зобов'язаний це проговорити, інакше числа виглядатимуть суперечливо.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod, parseMonth } from "@/lib/analytics/period";
import { fuelCost, revenueByRep, shiftFactsByUser, NO_SHIFTS } from "@/lib/analytics/facts";
import { collectedByRepBrand, collectedTotals, receivableRowsByRep, agingByRep } from "@/lib/analytics/money-facts";
import { EMPTY_AGING } from "@/lib/erp/receivables";
import { earningsByRep } from "@/lib/motivation/period-facts";
import { attainmentPercent } from "@/lib/motivation/engine";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const role = session.user.role;
  const isFullAccess = FULL_ACCESS_ROLES.includes(role);
  if (!isFullAccess && role !== "SALES") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = parsePeriod(searchParams);
  const monthRange = parseMonth(period.toDay.slice(0, 7));
  const { month, periodStart } = monthRange;

  const requestedRep = searchParams.get("repId") ?? searchParams.get("rep");
  const repFilter = isFullAccess
    ? requestedRep && requestedRep !== "ALL"
      ? requestedRep
      : null
    : session.user.id;

  const now = new Date();

  const [reps, revenue, shiftFacts, vehicles, collected, receivableRows, plans, monthRevenue] = await Promise.all([
    // База рядків — усі торгові, а не лише ті, хто продавав: торговий без
    // продажів, але з дебіторкою і витратами на паливо — теж рядок, і саме
    // такий рядок найцікавіший.
    prisma.user.findMany({
      where: { role: "SALES", ...(repFilter ? { id: repFilter } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    revenueByRep(period.from, period.to, repFilter),
    shiftFactsByUser(period.from, period.to, repFilter),
    prisma.salesVehicle.findMany({
      select: { repId: true, label: true, fuelConsumption: true, fuelPricePerL: true },
    }),
    collectedByRepBrand(period.from, period.to, repFilter),
    receivableRowsByRep(repFilter),
    prisma.salesPlan.findMany({
      where: {
        period: "MONTH",
        metric: "REVENUE",
        periodStart,
        brandId: null,
        ...(repFilter ? { repId: repFilter } : {}),
      },
      select: { repId: true, targetValue: true },
    }),
    // Факт для плану — за місяць, а не за обраний період
    revenueByRep(monthRange.from, monthRange.to, repFilter),
  ]);

  const repIds = reps.map((r) => r.id);

  // Рушій отримує вже завантажені дані — інакше ті самі два важкі запити
  // виконалися б удруге.
  const earnings = await earningsByRep(repIds, period, month, {
    collected,
    receivables: receivableRows,
  });

  const revenueByRepId = new Map(revenue.map((r) => [r.repId, r]));
  const monthRevenueByRepId = new Map(monthRevenue.map((r) => [r.repId, r.amount]));
  const shiftsByRepId = new Map(shiftFacts.map((f) => [f.userId, f]));
  const vehicleByRepId = new Map(vehicles.map((v) => [v.repId, v]));
  const collectedByRepId = collectedTotals(collected);
  const aging = agingByRep(receivableRows);
  const planByRepId = new Map(plans.map((p) => [p.repId ?? "", p.targetValue]));

  const rows = reps.map((rep) => {
    const rev = revenueByRepId.get(rep.id);
    const shifts = shiftsByRepId.get(rep.id) ?? NO_SHIFTS;
    const fuel = fuelCost(shifts.workKm, vehicleByRepId.get(rep.id) ?? null, shifts.daysWorked);
    const debt = aging.get(rep.id) ?? EMPTY_AGING;
    const money = collectedByRepId.get(rep.id) ?? { amount: 0, profit: 0 };
    const target = planByRepId.get(rep.id) ?? 0;
    const monthActual = monthRevenueByRepId.get(rep.id) ?? 0;
    const earned = earnings.get(rep.id) ?? null;

    const docs = rev?.docs ?? 0;
    const amount = rev?.amount ?? 0;
    const profit = rev?.profit ?? 0;

    return {
      repId: rep.id,
      repName: rep.name,
      revenue: amount,
      docs,
      clients: rev?.clients ?? 0,
      avgCheck: docs > 0 ? amount / docs : 0,
      profit,
      plan: {
        target,
        actual: monthActual,
        attainment: attainmentPercent("REVENUE", monthActual, target),
      },
      fuel: { cost: fuel.cost, workKm: fuel.workKm, hasVehicle: vehicleByRepId.has(rep.id) },
      collected: money.amount,
      collectedProfit: money.profit,
      receivables: {
        total: debt.total,
        overdue: debt.overdue,
        overdueRatio: debt.overdueRatio,
        buckets: debt.buckets,
        /** Робоча частина за етапами: товар їде vs чекаємо гроші */
        stages: debt.stages,
        /** Борг без відвантажень у базі — старший за нашу історію */
        unknown: debt.unknown,
      },
      earnings: earned
        ? {
            total: earned.total,
            gross: earned.gross,
            penalties: earned.penalties,
            schemeName: earned.schemeName,
          }
        : null,
      /** Прибуток по продажах мінус пальне: що торговий лишив компанії */
      net: profit - fuel.cost,
    };
  });

  rows.sort((a, b) => b.revenue - a.revenue);

  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const totalTarget = sum((r) => r.plan.target);
  const totalPlanActual = sum((r) => r.plan.actual);
  const totalDocs = sum((r) => r.docs);
  const totalRevenue = sum((r) => r.revenue);

  // Дебіторка, яку не вдалося віднести ні до документа, ні до закріпленого
  // клієнта. Не розкидаємо її по торгових — показуємо окремо, щоб сума в
  // таблиці не розходилася з реальним боргом компанії мовчки.
  const orphan = receivableRows.filter((r) => !r.repId);

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    month,
    receivablesAsOf: now.toISOString(),
    scope: isFullAccess ? (repFilter ? "single" : "all") : "own",
    rows,
    totals: {
      revenue: totalRevenue,
      docs: totalDocs,
      clients: sum((r) => r.clients),
      avgCheck: totalDocs > 0 ? totalRevenue / totalDocs : 0,
      profit: sum((r) => r.profit),
      plan: {
        target: totalTarget,
        actual: totalPlanActual,
        attainment: attainmentPercent("REVENUE", totalPlanActual, totalTarget),
      },
      fuelCost: sum((r) => r.fuel.cost),
      collected: sum((r) => r.collected),
      receivableTotal: sum((r) => r.receivables.total),
      receivableOverdue: sum((r) => r.receivables.overdue),
      receivableUnknown: sum((r) => r.receivables.unknown),
      earnings: sum((r) => r.earnings?.total ?? 0),
      /** Скільком торговим узагалі є за чим рахувати заробіток */
      earningsCovered: rows.filter((r) => r.earnings).length,
      net: sum((r) => r.net),
    },
    unattributed: {
      count: orphan.length,
      total: orphan.reduce((s, r) => s + r.debt, 0),
    },
  });
}
