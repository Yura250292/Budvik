/**
 * Підтвердження прийому готівки від водія.
 *
 * Підтверджує лише офіс (ADMIN/MANAGER) — інакше водій сам собі закривав
 * би здачу, і сенс звірки зникав. Повторне підтвердження — 409, а не
 * мовчазне перезаписування: хто саме і коли прийняв гроші, має лишитися.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const EDIT_ROLES = ["ADMIN", "MANAGER"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    confirmedAmount?: number | null;
  } | null;

  const existing = await prisma.cashHandover.findUnique({
    where: { id },
    select: { id: true, amount: true, confirmedAt: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Запис не знайдено" }, { status: 404 });
  }
  if (existing.confirmedAt) {
    return NextResponse.json({ error: "Здачу вже підтверджено" }, { status: 409 });
  }

  let confirmedAmount = existing.amount;
  if (typeof body?.confirmedAmount === "number") {
    if (!Number.isFinite(body.confirmedAmount) || body.confirmedAmount < 0) {
      return NextResponse.json({ error: "Некоректна сума" }, { status: 400 });
    }
    confirmedAmount = Math.round(body.confirmedAmount * 100) / 100;
  }

  const handover = await prisma.cashHandover.update({
    where: { id },
    data: {
      confirmedAt: new Date(),
      confirmedById: session.user.id,
      confirmedAmount,
    },
  });

  return NextResponse.json({ handover });
}

/** Скасувати підтвердження — прийняли помилково не ту здачу. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { id } = await params;
  const handover = await prisma.cashHandover.update({
    where: { id },
    data: { confirmedAt: null, confirmedById: null, confirmedAmount: null },
  });

  return NextResponse.json({ handover });
}
