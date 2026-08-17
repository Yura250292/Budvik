/**
 * Виконання планів за місяць: план проти факту, торговий × бренд.
 *
 * Факт рахується тим самим фільтром, що й уся аналітика продажів
 * (див. src/lib/analytics/facts.ts), інакше «оборот» на цій вкладці і на
 * головній показував би різні числа.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseMonth } from "@/lib/analytics/period";
import { kyivDate } from "@/lib/date/kyiv";
import { revenueByRep, revenueByRepBrand } from "@/lib/analytics/facts";
import { attainmentPercent, runRate } from "@/lib/motivation/engine";

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
  const { month, periodStart, from, to } = parseMonth(searchParams.get("month"));

  // Метрика плану: оборот (типово) або вал. Плани по обороту й по прибутку
  // живуть у SalesPlan окремими рядками, тож і читати їх треба окремо —
  // змішати в одній таблиці означало б порівнювати гривні з гривнями, які
  // означають різне.
  const metric = searchParams.get("metric") === "PROFIT" ? "PROFIT" : "REVENUE";

  const requestedRep = searchParams.get("repId");
  const repFilter = isFullAccess ? (requestedRep && requestedRep !== "ALL" ? requestedRep : null) : session.user.id;

  const [plans, reps, brands, byRep, byRepBrand] = await Promise.all([
    prisma.salesPlan.findMany({
      where: {
        period: "MONTH",
        metric,
        periodStart,
        ...(repFilter ? { repId: repFilter } : {}),
      },
      select: { repId: true, brandId: true, targetValue: true },
    }),
    prisma.user.findMany({
      where: { role: "SALES", ...(repFilter ? { id: repFilter } : {}) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.brand.findMany({
      where: { isActive: true },
      select: { id: true, name: true, color: true },
      orderBy: [{ priority: "desc" }, { name: "asc" }],
    }),
    revenueByRep(from, to, repFilter),
    revenueByRepBrand(from, to, repFilter),
  ]);

  // Факт залежить від метрики: для PROFIT це вал, для REVENUE — оборот.
  const factOf = (r: { amount: number; profit: number }) =>
    metric === "PROFIT" ? r.profit : r.amount;

  const totalByRep = new Map(byRep.map((r) => [r.repId, r]));
  const brandKey = (repId: string, brandId: string | null) => `${repId}::${brandId ?? ""}`;
  const brandActual = new Map<string, number>();
  for (const row of byRepBrand) {
    if (!row.brandId) continue; // «Без бренду» не має плану — див. нижче
    brandActual.set(brandKey(row.repId, row.brandId), factOf(row));
  }

  const planned = new Map(plans.map((p) => [brandKey(p.repId ?? "", p.brandId), p.targetValue]));

  // Рядок на кожну пару торговий × (бренд | загальний), де є або план, або факт.
  const rows: Array<{
    repId: string;
    repName: string;
    brandId: string | null;
    brandName: string | null;
    target: number;
    actual: number;
    attainment: number;
  }> = [];

  const brandNameById = new Map(brands.map((b) => [b.id, b.name]));

  for (const rep of reps) {
    const totalRow = totalByRep.get(rep.id);
    const totalActual = totalRow ? factOf(totalRow) : 0;
    const totalTarget = planned.get(brandKey(rep.id, null)) ?? 0;

    rows.push({
      repId: rep.id,
      repName: rep.name,
      brandId: null,
      brandName: null,
      target: totalTarget,
      actual: totalActual,
      attainment: attainmentPercent(metric, totalActual, totalTarget),
    });

    for (const brand of brands) {
      const target = planned.get(brandKey(rep.id, brand.id)) ?? 0;
      const actual = brandActual.get(brandKey(rep.id, brand.id)) ?? 0;
      if (target <= 0 && actual <= 0) continue;

      rows.push({
        repId: rep.id,
        repName: rep.name,
        brandId: brand.id,
        brandName: brandNameById.get(brand.id) ?? null,
        target,
        actual,
        attainment: attainmentPercent(metric, actual, target),
      });
    }
  }

  const teamTarget = rows.filter((r) => !r.brandId).reduce((s, r) => s + r.target, 0);
  const teamActual = rows.filter((r) => !r.brandId).reduce((s, r) => s + r.actual, 0);

  // Темп: скільки днів місяця минуло на СЬОГОДНІ за Києвом.
  //
  // Довжину місяця беремо з kyivDate(to): parseMonth уже поставив у `to`
  // останній день, тож рахувати її повторно через Date.UTC не треба.
  // Для МИНУЛОГО місяця днів «минуло» рівно стільки, скільки в ньому є —
  // тоді runRate зводить прогноз до факту сам, і окремої гілки не потрібно.
  const daysTotal = Number(kyivDate(to).slice(8, 10));
  const today = kyivDate(new Date());
  const daysPassed = today.slice(0, 7) === month ? Number(today.slice(8, 10)) : daysTotal;

  return NextResponse.json({
    month,
    metric,
    scope: isFullAccess ? (repFilter ? "single" : "all") : "own",
    rows,
    totals: {
      target: teamTarget,
      actual: teamActual,
      attainment: attainmentPercent(metric, teamActual, teamTarget),
    },
    // Темп рахуємо по команді загалом і по кожному торговому: керівник
    // дивиться, чи витягне місяць відділ, торговий — чи витягне він сам.
    runRate: runRate(teamActual, teamTarget, daysPassed, daysTotal),
    runRateByRep: Object.fromEntries(
      rows
        .filter((r) => !r.brandId && r.target > 0)
        .map((r) => [r.repId, runRate(r.actual, r.target, daysPassed, daysTotal)])
    ),
  });
}
