/**
 * Ручні надбавки водіям: доставка Новою поштою, підміна, утримання.
 *
 * Те, чого немає в 1С і що не виводиться з маршрутного листа. Причина
 * обов'язкова — саме вона пояснює рядок у розрахунку; сума може бути
 * від'ємною (утримання), але не нулем.
 *
 * Редагування навмисно немає: виправлення — це видалити й додати заново,
 * тоді в createdBy лишається слід того, хто ввів фінальну цифру.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parsePeriod } from "@/lib/analytics/period";
import { kyivDayStart } from "@/lib/date/kyiv";
import { loadBonuses } from "@/lib/drivers/payroll-facts";

export const dynamic = "force-dynamic";

const EDIT_ROLES = ["ADMIN", "MANAGER"];

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const role = session.user.role;
  const isFullAccess = EDIT_ROLES.includes(role);
  if (!isFullAccess && role !== "DRIVER") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const period = parsePeriod(searchParams);
  const driverFilter = searchParams.get("driverId");
  const restrictToDriver = isFullAccess ? driverFilter : session.user.id;

  const bonuses = await loadBonuses(period.from, period.to, restrictToDriver);
  return NextResponse.json({ canEdit: isFullAccess, bonuses });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as {
    driverId?: string;
    day?: string;
    amount?: number;
    reason?: string;
  } | null;

  if (!body?.driverId) {
    return NextResponse.json({ error: "Потрібен водій" }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.day ?? "")) {
    return NextResponse.json({ error: "Потрібна дата у форматі РРРР-ММ-ДД" }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ error: "Сума не може бути нулем" }, { status: 400 });
  }
  if (Math.abs(amount) > 100000) {
    return NextResponse.json({ error: "Сума виглядає помилковою (понад 100 000 ₴)" }, { status: 400 });
  }

  const reason = body.reason?.trim();
  if (!reason) {
    return NextResponse.json({ error: "Вкажіть причину надбавки" }, { status: 400 });
  }

  const driver = await prisma.user.findUnique({
    where: { id: body.driverId },
    select: { role: true },
  });
  if (!driver || driver.role !== "DRIVER") {
    return NextResponse.json({ error: "Користувач не є водієм" }, { status: 400 });
  }

  const bonus = await prisma.driverBonus.create({
    data: {
      driverId: body.driverId,
      date: kyivDayStart(body.day!),
      amount,
      reason,
      createdById: session.user.id,
    },
    select: { id: true, date: true, amount: true, reason: true },
  });

  return NextResponse.json({ ok: true, bonus });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Потрібен id надбавки" }, { status: 400 });
  }

  const existing = await prisma.driverBonus.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Надбавку не знайдено" }, { status: 404 });
  }

  await prisma.driverBonus.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
