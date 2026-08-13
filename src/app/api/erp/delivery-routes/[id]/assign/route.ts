/**
 * Передача маршруту водію на дату — і відкликання назад у чернетку.
 *
 * До цієї передачі маршрут існує лише для логіста: планшет водія фільтрує
 * дні за статусом ASSIGNED і вище. Тому чернетку можна складати кілька днів,
 * не показуючи водієві напівготовий список.
 *
 * POST   — передати (driverId + date можна змінити тут же)
 * DELETE — відкликати назад у чернетку, поки водій не поїхав
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findDayConflict } from "@/lib/routes/editable";
import { kyivDate } from "@/lib/date/kyiv";

const DATE_FMT = new Intl.DateTimeFormat("uk-UA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Europe/Kyiv",
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { driverId: bodyDriverId, date: bodyDate, force } = body as {
    driverId?: string;
    date?: string;
    force?: boolean;
  };

  const route = await prisma.deliveryRoute.findUnique({
    where: { id },
    select: {
      id: true,
      number: true,
      status: true,
      driverId: true,
      date: true,
      _count: { select: { stops: true } },
    },
  });
  if (!route) return NextResponse.json({ error: "Маршрут не знайдено" }, { status: 404 });

  if (route.status === "COMPLETED" || route.status === "CANCELLED") {
    return NextResponse.json(
      { error: "Маршрут уже закритий — передати його не можна" },
      { status: 400 }
    );
  }

  const driverId = bodyDriverId ?? route.driverId;
  const date = bodyDate ? new Date(bodyDate) : route.date;

  if (!driverId) {
    return NextResponse.json(
      { error: "Спершу оберіть водія — маршрут передається конкретній людині" },
      { status: 400 }
    );
  }
  if (Number.isNaN(date.getTime())) {
    return NextResponse.json({ error: "Невірна дата" }, { status: 400 });
  }
  if (route._count.stops === 0) {
    return NextResponse.json(
      { error: "У маршруті немає жодної точки — нема чого передавати" },
      { status: 400 }
    );
  }

  const driver = await prisma.user.findUnique({
    where: { id: driverId },
    select: { id: true, role: true, name: true },
  });
  if (!driver) return NextResponse.json({ error: "Водія не знайдено" }, { status: 404 });
  if (driver.role !== "DRIVER") {
    return NextResponse.json(
      { error: `${driver.name ?? "Користувач"} не має ролі «Водій»` },
      { status: 400 }
    );
  }

  // Два маршрути на одного водія в один день — типова причина «водій не бачить
  // маршрут»: планшет візьме лише один. Пропускаємо тільки зі свідомим force.
  const conflict = await findDayConflict(driverId, date, id);
  if (conflict && !force) {
    return NextResponse.json(
      {
        error:
          `У цього водія на ${DATE_FMT.format(date)} уже є переданий маршрут ${conflict.number}. ` +
          `Планшет показує один маршрут на день — другий водій не побачить.`,
        conflict,
        needsForce: true,
      },
      { status: 409 }
    );
  }

  const updated = await prisma.deliveryRoute.update({
    where: { id },
    data: {
      driverId,
      date,
      status: "ASSIGNED",
      assignedAt: new Date(),
      assignedById: session.user.id,
    },
    select: { id: true, number: true, date: true, assignedAt: true, status: true },
  });

  // Сповіщення водієві: без нього про переданий маршрут можна дізнатися,
  // лише самому відкривши планшет.
  await prisma.notification.create({
    data: {
      userId: driverId,
      type: "ROUTE_ASSIGNED",
      title: `Маршрут на ${DATE_FMT.format(date)}`,
      body: `${route.number}: ${route._count.stops} ${pluralStops(route._count.stops)}. Відкрийте карту дня.`,
      relatedId: id,
    },
  });

  return NextResponse.json({
    ok: true,
    route: updated,
    day: kyivDate(date),
    driverName: driver.name,
  });
}

/** Відкликати назад у чернетку. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const route = await prisma.deliveryRoute.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!route) return NextResponse.json({ error: "Маршрут не знайдено" }, { status: 404 });

  if (route.status !== "ASSIGNED") {
    return NextResponse.json(
      {
        error:
          route.status === "IN_PROGRESS"
            ? "Водій уже почав виконувати маршрут — відкликати пізно"
            : "Маршрут не передано водієві",
      },
      { status: 400 }
    );
  }

  await prisma.deliveryRoute.update({
    where: { id },
    data: { status: "PLANNED", assignedAt: null, assignedById: null },
  });

  return NextResponse.json({ ok: true });
}

function pluralStops(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "точка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "точки";
  return "точок";
}
