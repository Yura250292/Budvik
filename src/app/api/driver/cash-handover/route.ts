/**
 * Здача каси водієм: «зібрав за день N ₴ — везу в офіс».
 *
 * Visit каже, скільки водій забрав у клієнта, але не каже, чи гроші
 * доїхали. Тут фіксується момент здачі, а підтверджує прийом офіс —
 * /api/admin/drivers/cash-handovers/[id].
 *
 * Сума приходить від водія (він може порахувати інакше: решта, розмін),
 * але очікуване «на руках» рахує СЕРВЕР — інакше зламаний або хитрий
 * клієнт міг би прислати зручну собі розбіжність.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { cashForDay } from "@/lib/drivers/cash";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["DRIVER", "ADMIN", "MANAGER"];

/** Далі назад здавати нічого: місячна зарплата вже закрита. */
const MAX_BACKDATE_DAYS = 14;

type Body = {
  amount?: number;
  day?: string;
  comment?: string | null;
};

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некоректний JSON" }, { status: 400 });
  }

  if (typeof body.amount !== "number" || !Number.isFinite(body.amount)) {
    return NextResponse.json({ error: "Не вказано суму" }, { status: 400 });
  }
  const amount = Math.round(body.amount * 100) / 100;
  if (amount <= 0) {
    return NextResponse.json({ error: "Сума має бути більшою за нуль" }, { status: 400 });
  }

  const today = kyivDate(new Date());
  const day = body.day || today;
  const dayStart = kyivDayStart(day);
  const todayStart = kyivDayStart(today);

  if (dayStart.getTime() > todayStart.getTime()) {
    return NextResponse.json({ error: "Не можна здати касу наперед" }, { status: 400 });
  }
  const backDays = Math.round(
    (todayStart.getTime() - dayStart.getTime()) / (24 * 60 * 60 * 1000)
  );
  if (backDays > MAX_BACKDATE_DAYS) {
    return NextResponse.json(
      { error: `Задавнена дата: здавати можна не старше ${MAX_BACKDATE_DAYS} днів` },
      { status: 400 }
    );
  }

  const driverId = session.user.id;
  const cash = await cashForDay(driverId, dayStart);

  const handover = await prisma.cashHandover.create({
    data: {
      driverId,
      day: dayStart,
      amount,
      expectedAmount: cash.onHands,
      comment: body.comment?.trim() || null,
    },
  });

  return NextResponse.json({
    handover,
    cash: await cashForDay(driverId, dayStart),
  });
}

/** Власні здачі за період — для історії водія. */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const where: { driverId: string; day?: { gte?: Date; lte?: Date } } = {
    driverId: session.user.id,
  };
  if (from || to) {
    where.day = {};
    if (from) where.day.gte = kyivDayStart(from);
    if (to) where.day.lte = kyivDayStart(to);
  }

  const handovers = await prisma.cashHandover.findMany({
    where,
    orderBy: [{ day: "desc" }, { handedAt: "desc" }],
    take: 200,
  });

  return NextResponse.json({ handovers });
}

/**
 * Зняти власну помилкову здачу — поки офіс її не підтвердив.
 * Після підтвердження запис стає документом про прийняті гроші, і
 * прибирати його водієві вже не можна.
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Не вказано запис" }, { status: 400 });
  }

  const existing = await prisma.cashHandover.findUnique({
    where: { id },
    select: { id: true, driverId: true, day: true, confirmedAt: true },
  });
  if (!existing || existing.driverId !== session.user.id) {
    return NextResponse.json({ error: "Запис не знайдено" }, { status: 404 });
  }
  if (existing.confirmedAt) {
    return NextResponse.json(
      { error: "Здачу вже підтвердив офіс — зверніться до менеджера" },
      { status: 409 }
    );
  }

  await prisma.cashHandover.delete({ where: { id } });

  return NextResponse.json({
    ok: true,
    cash: await cashForDay(existing.driverId, existing.day),
  });
}
