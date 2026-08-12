/**
 * Ручний override зони доставки контрагента: місто чи область.
 *
 * Автовизначення (полігон об'їзної за координатами, далі евристика адреси)
 * помиляється там, де геокодування дало адресу без області або координат
 * немає взагалі. Адмін тут має останнє слово, і його рішення діє
 * ретроспективно: зона ніде не зберігається як факт, вона щоразу
 * рахується наново — тож зарплата за минулий місяць перерахується сама.
 *
 * null повертає точку на автовизначення.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const EDIT_ROLES = ["ADMIN", "MANAGER"];

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    counterpartyId?: string;
    zone?: "CITY" | "OBLAST" | null;
  } | null;

  if (!body?.counterpartyId) {
    return NextResponse.json({ error: "Потрібен контрагент" }, { status: 400 });
  }

  const zone = body.zone ?? null;
  if (zone !== null && zone !== "CITY" && zone !== "OBLAST") {
    return NextResponse.json({ error: "Зона має бути CITY, OBLAST або порожньою" }, { status: 400 });
  }

  const existing = await prisma.counterparty.findUnique({
    where: { id: body.counterpartyId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Контрагента не знайдено" }, { status: 404 });
  }

  const counterparty = await prisma.counterparty.update({
    where: { id: body.counterpartyId },
    data: { deliveryZone: zone },
    select: { id: true, name: true, deliveryZone: true },
  });

  return NextResponse.json({ ok: true, counterparty });
}
