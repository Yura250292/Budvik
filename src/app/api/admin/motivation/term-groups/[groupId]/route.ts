/**
 * Редагування і видалення групи індивідуальних умов.
 *
 * DELETE зносить і всі місячні продажі групи (onDelete: Cascade) — тобто
 * переписує історію виплат. Для «більше не співпрацюємо» правильніше
 * isActive: false — група зникає з нових місяців, а старі лишаються як були.
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

export async function PUT(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const denied = await guard();
  if (denied) return denied;
  const { groupId } = await params;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Порожній запит" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.brands === "string") data.brands = body.brands.trim();
  if (PAYROLL_CURRENCIES.includes(body.currency)) data.currency = body.currency;
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;

  const group = await prisma.individualTermsGroup
    .update({ where: { id: groupId }, data })
    .catch(() => null);
  if (!group) return NextResponse.json({ error: "Групу не знайдено" }, { status: 404 });

  return NextResponse.json({ group });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const denied = await guard();
  if (denied) return denied;
  const { groupId } = await params;

  const deleted = await prisma.individualTermsGroup
    .delete({ where: { id: groupId } })
    .catch(() => null);
  if (!deleted) return NextResponse.json({ error: "Групу не знайдено" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
