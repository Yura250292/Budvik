/**
 * Налаштування мотивації: схеми, правила і хто на якій схемі.
 *
 * Одна відповідь на всю вкладку — схем і торгових десятки, не тисячі,
 * а окремі запити означали б три спінери там, де достатньо одного.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MOTIVATION_EDIT_ROLES as EDIT_ROLES } from "@/lib/motivation/labels";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const now = new Date();

  const [schemes, reps, brands, assignments] = await Promise.all([
    prisma.motivationScheme.findMany({
      include: { rules: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    prisma.user.findMany({
      where: { role: "SALES" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.brand.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: [{ priority: "desc" }, { name: "asc" }],
    }),
    // Чинні призначення: ті самі межі, що й у resolveSchemes
    prisma.motivationAssignment.findMany({
      where: { validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }] },
      orderBy: { validFrom: "desc" },
      select: { repId: true, schemeId: true, validFrom: true },
    }),
  ]);

  const current = new Map<string, { schemeId: string; validFrom: string }>();
  for (const a of assignments) {
    if (current.has(a.repId)) continue; // найсвіжіше
    current.set(a.repId, { schemeId: a.schemeId, validFrom: a.validFrom.toISOString() });
  }

  return NextResponse.json({
    schemes: schemes.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      isActive: s.isActive,
      isDefault: s.isDefault,
      rules: s.rules.map((r) => ({
        id: r.id,
        type: r.type,
        sortOrder: r.sortOrder,
        isActive: r.isActive,
        brandId: r.brandId,
        value: r.value,
        planMetric: r.planMetric,
        thresholdFrom: r.thresholdFrom,
        thresholdTo: r.thresholdTo,
        overdueTolerance: r.overdueTolerance,
        notes: r.notes,
      })),
    })),
    reps: reps.map((r) => ({
      id: r.id,
      name: r.name,
      currentAssignment: current.get(r.id) ?? null,
    })),
    brands,
  });
}
