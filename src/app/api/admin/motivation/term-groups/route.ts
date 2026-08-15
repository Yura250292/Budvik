/**
 * Групи «фірм за дужками» — бренди з індивідуальними умовами (APRO тощо).
 * Список редагує адмін: сьогодні за дужками чотири бренди, завтра може
 * з'явитися п'ятий постачальник зі своїми умовами.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MOTIVATION_EDIT_ROLES as EDIT_ROLES } from "@/lib/motivation/labels";
import { PAYROLL_CURRENCIES } from "@/lib/motivation/payroll";

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

export async function POST(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Вкажіть назву групи" }, { status: 400 });
  }
  const currency = PAYROLL_CURRENCIES.includes(body?.currency) ? body.currency : "USD";
  const brands = typeof body?.brands === "string" ? body.brands.trim() : "";

  const last = await prisma.individualTermsGroup.findFirst({
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const group = await prisma.individualTermsGroup.create({
    data: { name, brands, currency, sortOrder: (last?.sortOrder ?? 0) + 1 },
  });

  return NextResponse.json({ group });
}
