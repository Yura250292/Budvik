/**
 * План доставки на день. Рахує й віддає — не пише нічого.
 *
 * Уся робота в src/lib/routes/build-day-plan.ts: те саме складання плану
 * викликає інструмент помічника, і роздвоювати його між роутом і чатом
 * означало б чекати, поки два плани розійдуться.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRoles, OFFICE_ROLES } from "@/lib/app/identity";
import { kyivDate } from "@/lib/date/kyiv";
import { buildDayPlan, type BuildDayPlanInput } from "@/lib/routes/build-day-plan";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireRoles(req, OFFICE_ROLES);
  if (!auth.ok) return auth.response;

  let body: Partial<BuildDayPlanInput> = {};
  try {
    body = await req.json();
  } catch {
    // Порожнє тіло — рахуємо план на сьогодні без пінів і винятків.
    body = {};
  }

  const plan = await buildDayPlan({
    date: body.date ?? kyivDate(new Date()),
    driverIds: body.driverIds,
    pins: body.pins,
    exclude: body.exclude,
    fixed: body.fixed,
  });

  if ("error" in plan) return NextResponse.json(plan, { status: 400 });
  return NextResponse.json(plan);
}
