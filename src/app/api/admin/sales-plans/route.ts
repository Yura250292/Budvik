/**
 * Плани продажів (КПІ) на місяць: торговий × бренд.
 *
 * Використовує наявну модель SalesPlan (period = MONTH, metric = REVENUE).
 * brandId = null означає «загальний оборот за місяць», інакше — план по
 * конкретному бренду.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseMonth } from "@/lib/analytics/period";

export const dynamic = "force-dynamic";

const EDIT_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const role = session.user.role;
  const canEdit = EDIT_ROLES.includes(role);
  if (!canEdit && role !== "SALES") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const { month, periodStart } = parseMonth(searchParams.get("month"));

  // Торговий бачить лише свої плани — незалежно від параметрів запиту.
  const repScope = canEdit ? {} : { repId: session.user.id };

  const [plans, reps, brands] = await Promise.all([
    prisma.salesPlan.findMany({
      where: { period: "MONTH", metric: "REVENUE", periodStart, ...repScope },
      select: { id: true, repId: true, brandId: true, targetValue: true, notes: true },
    }),
    prisma.user.findMany({
      where: { role: "SALES", ...(canEdit ? {} : { id: session.user.id }) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.brand.findMany({
      where: { isActive: true },
      select: { id: true, name: true, color: true, priority: true },
      orderBy: [{ priority: "desc" }, { name: "asc" }],
    }),
  ]);

  return NextResponse.json({ month, canEdit, plans, reps, brands });
}

type Entry = { repId: string; brandId: string | null; targetValue: number };

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { month?: string; entries?: Entry[] } | null;
  if (!body || !Array.isArray(body.entries)) {
    return NextResponse.json({ error: "Очікується { month, entries: [] }" }, { status: 400 });
  }

  const { month, periodStart } = parseMonth(body.month ?? null);
  const authorId = session.user.id;

  const entries = body.entries.filter((e) => e && typeof e.repId === "string");
  if (entries.length > 500) {
    return NextResponse.json({ error: "Забагато рядків за один раз" }, { status: 400 });
  }

  // findFirst → update/create, а не upsert: у @@unique є nullable brandId, а
  // Postgres рахує NULL-и різними, тож upsert по цьому ключу створював би
  // дублікати загальних планів (brandId = null) при кожному збереженні.
  let saved = 0;
  let removed = 0;

  await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      const brandId = entry.brandId ?? null;
      const target = Number(entry.targetValue);

      const existing = await tx.salesPlan.findFirst({
        where: { period: "MONTH", metric: "REVENUE", periodStart, repId: entry.repId, brandId },
        select: { id: true },
      });

      // Порожнє або нульове значення = плану немає. Зберігати нуль означало б
      // «план 0 грн виконано на 0%» замість «плану не ставили».
      if (!Number.isFinite(target) || target <= 0) {
        if (existing) {
          await tx.salesPlan.delete({ where: { id: existing.id } });
          removed++;
        }
        continue;
      }

      if (existing) {
        await tx.salesPlan.update({ where: { id: existing.id }, data: { targetValue: target } });
      } else {
        await tx.salesPlan.create({
          data: {
            period: "MONTH",
            metric: "REVENUE",
            periodStart,
            repId: entry.repId,
            brandId,
            targetValue: target,
            createdById: authorId,
          },
        });
      }
      saved++;
    }
  });

  return NextResponse.json({ ok: true, month, saved, removed });
}
