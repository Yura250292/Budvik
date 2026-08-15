/**
 * Розрахунок мотивації по валу за місяць: курси, сходинки, вал торгових
 * по валютах і продажі груп з індивідуальними умовами.
 *
 * Одна відповідь на всю вкладку (як у /api/admin/motivation): рядків —
 * одиниці, а розрахункові колонки клієнт рахує сам через payroll.ts,
 * тому сервер віддає лише збережені цифри та підказки план/факт.
 *
 * GET без запису місяця повертає заготовку з курсами і сходинками
 * попереднього місяця — щоб не передруковувати ті самі 45,1 щомісяця.
 * Запис у базі з'являється лише після першого збереження.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseMonth } from "@/lib/analytics/period";
import { revenueByRep } from "@/lib/analytics/facts";
import { MOTIVATION_EDIT_ROLES as EDIT_ROLES } from "@/lib/motivation/labels";
import { DEFAULT_TIERS, parseTiers } from "@/lib/motivation/payroll";

export const dynamic = "force-dynamic";

async function guard() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const { month, periodStart, from, to } = parseMonth(searchParams.get("month"));

  const [record, reps, groups, plans, revenue] = await Promise.all([
    prisma.motivationPayrollMonth.findUnique({
      where: { month: periodStart },
      include: { entries: true, termEntries: true },
    }),
    prisma.user.findMany({
      where: { role: "SALES" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.individualTermsGroup.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    // Підказка «План»: місячний план по обороту без розбивки на бренди
    prisma.salesPlan.findMany({
      where: { period: "MONTH", metric: "REVENUE", periodStart, brandId: null, repId: { not: null } },
      select: { repId: true, targetValue: true },
    }),
    // Підказка «Факт»: оборот по відвантаженню тим самим фільтром, що й аналітика
    revenueByRep(from, to),
  ]);

  return NextResponse.json({
    month,
    exists: !!record,
    settings: record
      ? {
          usdRate: record.usdRate,
          eurRate: record.eurRate,
          plnRate: record.plnRate,
          tiers: parseTiers(record.tiers),
        }
      : await previousSettings(periodStart),
    reps,
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      brands: g.brands,
      currency: g.currency,
      isActive: g.isActive,
    })),
    entries: (record?.entries ?? []).map((e) => ({
      repId: e.repId,
      workDays: e.workDays,
      planAmount: e.planAmount,
      factAmount: e.factAmount,
      grossUah: e.grossUah,
      grossUsd: e.grossUsd,
      grossEur: e.grossEur,
      grossPln: e.grossPln,
      clientBonuses: e.clientBonuses,
    })),
    termEntries: (record?.termEntries ?? []).map((t) => ({
      groupId: t.groupId,
      repId: t.repId,
      salesAmount: t.salesAmount,
      rentCoef: t.rentCoef,
      bonusPercent: t.bonusPercent,
    })),
    suggested: {
      plan: Object.fromEntries(plans.map((p) => [p.repId!, p.targetValue])),
      fact: Object.fromEntries(revenue.map((r) => [r.repId, r.amount])),
    },
  });
}

/** Курси і сходинки останнього збереженого місяця перед цим — як заготовка. */
async function previousSettings(before: Date) {
  const prev = await prisma.motivationPayrollMonth.findFirst({
    where: { month: { lt: before } },
    orderBy: { month: "desc" },
  });
  return prev
    ? { usdRate: prev.usdRate, eurRate: prev.eurRate, plnRate: prev.plnRate, tiers: parseTiers(prev.tiers) }
    : { usdRate: 0, eurRate: 0, plnRate: 0, tiers: DEFAULT_TIERS };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export async function PUT(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  if (!body || typeof body.month !== "string") {
    return NextResponse.json({ error: "Не вказано місяць" }, { status: 400 });
  }
  const { periodStart } = parseMonth(body.month);
  const tiers = parseTiers(body.tiers);

  const entries: Array<Record<string, unknown>> = Array.isArray(body.entries) ? body.entries : [];
  const termEntries: Array<Record<string, unknown>> = Array.isArray(body.termEntries)
    ? body.termEntries
    : [];

  await prisma.$transaction(async (tx) => {
    const monthRow = await tx.motivationPayrollMonth.upsert({
      where: { month: periodStart },
      create: {
        month: periodStart,
        usdRate: num(body.usdRate),
        eurRate: num(body.eurRate),
        plnRate: num(body.plnRate),
        tiers: tiers as object,
      },
      update: {
        usdRate: num(body.usdRate),
        eurRate: num(body.eurRate),
        plnRate: num(body.plnRate),
        tiers: tiers as object,
      },
    });

    for (const e of entries) {
      const repId = typeof e.repId === "string" ? e.repId : null;
      if (!repId) continue;
      const data = {
        workDays: Math.max(0, Math.round(num(e.workDays))),
        planAmount: num(e.planAmount),
        factAmount: num(e.factAmount),
        grossUah: num(e.grossUah),
        grossUsd: num(e.grossUsd),
        grossEur: num(e.grossEur),
        grossPln: num(e.grossPln),
        clientBonuses: num(e.clientBonuses),
      };
      await tx.motivationPayrollEntry.upsert({
        where: { monthId_repId: { monthId: monthRow.id, repId } },
        create: { monthId: monthRow.id, repId, ...data },
        update: data,
      });
    }

    for (const t of termEntries) {
      const repId = typeof t.repId === "string" ? t.repId : null;
      const groupId = typeof t.groupId === "string" ? t.groupId : null;
      if (!repId || !groupId) continue;
      const data = {
        salesAmount: num(t.salesAmount),
        rentCoef: numOrNull(t.rentCoef),
        bonusPercent: num(t.bonusPercent),
      };
      await tx.individualTermsEntry.upsert({
        where: { monthId_groupId_repId: { monthId: monthRow.id, groupId, repId } },
        create: { monthId: monthRow.id, groupId, repId, ...data },
        update: data,
      });
    }
  });

  return NextResponse.json({ ok: true });
}
