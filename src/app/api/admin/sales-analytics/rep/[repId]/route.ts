/**
 * Профіль торгового: продажі по брендах, поїздки, паливо, виконання плану,
 * дебіторка і заробіток в одній відповіді.
 *
 * Один payload, а не чотири запити з фронту: усі числа мають бути за той самий
 * період, інакше «оборот» і «км» на одній картці рахувалися б по-різному.
 * Виняток — дебіторка: це залишок станом на зараз, а не потік за період.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod, parseMonth } from "@/lib/analytics/period";
import { fuelCost, revenueByRepBrand, tripFactsByRep } from "@/lib/analytics/facts";
import { attainmentPercent } from "@/lib/motivation/engine";
import {
  collectedByRepBrand,
  collectedTotals,
  receivableRowsByRep,
  toDebtorList,
  sumAging,
} from "@/lib/analytics/money-facts";
import { earningsByRep } from "@/lib/motivation/period-facts";

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

  // Торговий може дивитися лише власний профіль.
  if (!isFullAccess && (role !== "SALES" || session.user.id !== repId)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = parsePeriod(searchParams);
  // План завжди місячний; беремо місяць кінця періоду.
  const { month, periodStart } = parseMonth(period.toDay.slice(0, 7));

  const rep = await prisma.user.findUnique({
    where: { id: repId },
    select: { id: true, name: true, email: true, phone: true, role: true, telegramUsername: true },
  });
  if (!rep) {
    return NextResponse.json({ error: "Торгового не знайдено" }, { status: 404 });
  }

  const docWhere = {
    externalId: { not: null },
    status: "CONFIRMED" as const,
    salesRepId: repId,
    createdAt: { gte: period.from, lte: period.to },
  };

  const [totals, byBrand, trips, vehicle, plans, documents, timeline, brands, collected, receivableRows] = await Promise.all([
    prisma.salesDocument.aggregate({
      where: docWhere,
      _count: { id: true },
      _sum: { totalAmount: true },
      _avg: { totalAmount: true },
    }),
    revenueByRepBrand(period.from, period.to, repId),
    tripFactsByRep(period.from, period.to, repId),
    prisma.salesVehicle.findUnique({
      where: { repId },
      select: { label: true, fuelConsumption: true, fuelPricePerL: true },
    }),
    prisma.salesPlan.findMany({
      where: { period: "MONTH", metric: "REVENUE", periodStart, repId },
      select: { brandId: true, targetValue: true },
    }),
    prisma.salesDocument.findMany({
      where: docWhere,
      select: {
        id: true,
        number: true,
        createdAt: true,
        totalAmount: true,
        counterparty: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.$queryRaw<Array<{ day: string; docs: number; amount: number }>>`
      SELECT
        to_char(date_trunc('day', s."createdAt" AT TIME ZONE 'Europe/Kyiv'), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS docs,
        SUM(s."totalAmount")::float AS amount
      FROM "SalesDocument" s
      WHERE s."externalId" IS NOT NULL
        AND s.status = 'CONFIRMED'
        AND s."salesRepId" = ${repId}
        AND s."createdAt" >= ${period.from} AND s."createdAt" <= ${period.to}
      GROUP BY 1
      ORDER BY 1
    `,
    prisma.brand.findMany({
      where: { isActive: true },
      select: { id: true, name: true, color: true },
    }),
    collectedByRepBrand(period.from, period.to, repId),
    receivableRowsByRep(repId),
  ]);

  // Заробіток рахується після: рушію потрібні вже завантажені зібране й борги.
  const earnings = (
    await earningsByRep([repId], period, month, { collected, receivables: receivableRows })
  ).get(repId);

  const collectedMoney = collectedTotals(collected).get(repId) ?? { amount: 0, profit: 0 };
  const aging = sumAging(receivableRows);

  const tripFacts = trips[0] ?? { trips: 0, totalKm: 0, personalKm: 0, checkpoints: 0, daysWorked: 0 };
  const fuel = fuelCost(tripFacts.totalKm, tripFacts.personalKm, vehicle, tripFacts.daysWorked);

  const planByBrand = new Map(plans.map((p) => [p.brandId ?? "", p.targetValue]));
  const brandMeta = new Map(brands.map((b) => [b.id, b]));
  const revenue = totals._sum.totalAmount ?? 0;
  const totalTarget = planByBrand.get("") ?? 0;

  // Бренди, де є продажі АБО план: бренд із планом і нулем продажів має бути
  // видно — це найважливіший рядок для розмови з торговим.
  const brandRows = new Map<string, { brandId: string | null; brandName: string; color: string | null; amount: number; qty: number; target: number }>();

  for (const row of byBrand) {
    const key = row.brandId ?? "none";
    brandRows.set(key, {
      brandId: row.brandId,
      brandName: row.brandName ?? "Без бренду",
      color: row.brandId ? brandMeta.get(row.brandId)?.color ?? null : null,
      amount: row.amount,
      qty: row.qty,
      target: row.brandId ? planByBrand.get(row.brandId) ?? 0 : 0,
    });
  }
  for (const plan of plans) {
    if (!plan.brandId || brandRows.has(plan.brandId)) continue;
    const meta = brandMeta.get(plan.brandId);
    brandRows.set(plan.brandId, {
      brandId: plan.brandId,
      brandName: meta?.name ?? "—",
      color: meta?.color ?? null,
      amount: 0,
      qty: 0,
      target: plan.targetValue,
    });
  }

  return NextResponse.json({
    period: { from: period.fromDay, to: period.toDay, days: period.days },
    month,
    rep,
    totals: {
      docs: totals._count.id,
      amount: revenue,
      average: totals._avg.totalAmount ?? 0,
    },
    plan: {
      target: totalTarget,
      actual: revenue,
      attainment: attainmentPercent("REVENUE", revenue, totalTarget),
    },
    byBrand: Array.from(brandRows.values())
      .map((b) => ({ ...b, attainment: attainmentPercent("REVENUE", b.amount, b.target) }))
      .sort((a, b) => b.amount - a.amount),
    trips: {
      count: tripFacts.trips,
      totalKm: tripFacts.totalKm,
      personalKm: tripFacts.personalKm,
      workKm: fuel.workKm,
      checkpoints: tripFacts.checkpoints,
      daysWorked: tripFacts.daysWorked,
      kmPerCheckpoint: tripFacts.checkpoints > 0 ? fuel.workKm / tripFacts.checkpoints : 0,
    },
    fuel: {
      label: vehicle?.label ?? null,
      hasVehicle: !!vehicle,
      fuelConsumption: fuel.fuelConsumption,
      fuelPricePerL: fuel.fuelPricePerL,
      liters: fuel.liters,
      cost: fuel.cost,
      costPerDay: fuel.costPerDay,
      /** Скільки пального «коштує» гривня обороту — видно неефективні напрямки */
      costPerRevenue: revenue > 0 ? fuel.cost / revenue : 0,
    },
    collected: {
      amount: collectedMoney.amount,
      profit: collectedMoney.profit,
      /** Яка частка проданого вже оплачена — головне питання до дебіторки */
      ratio: revenue > 0 ? (collectedMoney.amount / revenue) * 100 : 0,
    },
    receivables: {
      // Актуальність задає 1С, а не момент запиту
      syncedAt: receivableRows.reduce<string | null>((latest, r) => {
        const t = r.syncedAt ? new Date(r.syncedAt).toISOString() : null;
        return t && (!latest || t > latest) ? t : latest;
      }, null),
      total: aging.total,
      current: aging.current,
      overdue: aging.overdue,
      overdueRatio: aging.overdueRatio,
      buckets: aging.buckets,
      unknown: aging.unknown,
      // Найгірші зверху; сотні клієнтів на картці все одно не читають
      clients: toDebtorList(receivableRows).slice(0, 100),
    },
    earnings: earnings
      ? {
          schemeName: earnings.schemeName,
          total: earnings.total,
          gross: earnings.gross,
          penalties: earnings.penalties,
          lines: earnings.lines,
        }
      : null,
    timeline,
    documents: documents.map((d) => ({
      id: d.id,
      number: d.number,
      date: d.createdAt.toISOString(),
      amount: d.totalAmount,
      client: d.counterparty?.name ?? "—",
    })),
  });
}
