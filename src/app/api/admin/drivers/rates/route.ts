/**
 * Ставки зарплати водіїв.
 *
 * Історії немає навмисно: зміна ставки перераховує і минулі періоди. Це
 * свідомий компроміс — ставки міняються рідко й «заднім числом» тут
 * зазвичай і треба (виправлення помилки в тарифі). Якщо колись знадобиться
 * фіксувати минуле, до моделі додається validFrom, і вона стає журналом.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRates } from "@/lib/drivers/payroll-facts";

export const dynamic = "force-dynamic";

const EDIT_ROLES = ["ADMIN", "MANAGER"];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const canEdit = EDIT_ROLES.includes(session.user.role);
  if (!canEdit && session.user.role !== "DRIVER") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const rates = await getRates();
  return NextResponse.json({ canEdit, rates });
}

const NUMERIC_FIELDS = [
  "kmTier1Max",
  "kmTier1Rate",
  "kmTier2Max",
  "kmTier2Rate",
  "kmTier3Rate",
  "cityPointRate",
  "oblastPointRate",
  "turnoverPercent",
] as const;

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !EDIT_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Порожній запит" }, { status: 400 });
  }

  const data: Record<string, number> = {};
  for (const field of NUMERIC_FIELDS) {
    const value = Number(body[field]);
    if (!Number.isFinite(value) || value < 0) {
      return NextResponse.json({ error: `Поле «${field}» має бути невід'ємним числом` }, { status: 400 });
    }
    data[field] = value;
  }

  if (data.kmTier1Max >= data.kmTier2Max) {
    return NextResponse.json(
      { error: "Верхня межа першого тіру має бути меншою за другий" },
      { status: 400 }
    );
  }
  if (data.turnoverPercent > 100) {
    return NextResponse.json({ error: "Відсоток не може перевищувати 100" }, { status: 400 });
  }

  const rates = await prisma.driverPayrollRates.upsert({
    where: { id: "default" },
    create: { id: "default", ...data },
    update: data,
  });

  return NextResponse.json({ ok: true, rates });
}
