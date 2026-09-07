/**
 * Мої накладні за день — і в застосунку, і в кабінеті складу.
 *
 * Складовщик бачить лише свої: чужі документи йому ні до чого, а офіс дивиться
 * той самий матеріал у /admin/warehouse-reports, де є всі.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, WAREHOUSE_ROLES } from "@/lib/app/identity";
import { daySummary, reportDto } from "@/lib/warehouse/reports";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, WAREHOUSE_ROLES);
  if (!auth.ok) return auth.response;
  const userId = auth.me.userId;

  const { searchParams } = new URL(req.url);
  const day = searchParams.get("day") || kyivDate(new Date());

  // Межі доби київські: наївний new Date("2026-09-07") дав би опівніч UTC, і
  // накладна, знята о 02:30 ночі, випала б із «сьогодні».
  const from = kyivDayStart(day);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

  const [reports, summary] = await Promise.all([
    prisma.warehouseReport.findMany({
      where: { userId, createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    daySummary(userId, day),
  ]);

  return NextResponse.json(
    { day, reports: reports.map(reportDto), summary },
    { headers: { "Cache-Control": "no-store" } }
  );
}
