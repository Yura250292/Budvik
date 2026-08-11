import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Ручне коригування зміни складовщика (лише ADMIN).
 *
 * Потрібно, бо бот ставить час автоматично: людина може забути закрити
 * зміну ввечері й закрити її вранці — тоді в звітах з'являється зміна
 * на 15 годин. Тут адмін виправляє час руками.
 *
 * durationMinutes НЕ приймаємо з клієнта — рахуємо з часу відкриття та
 * закриття, інакше в базі з'явилася б тривалість, що не збігається з
 * власними ж датами зміни.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  const shift = await prisma.warehouseShift.findUnique({
    where: { id },
    select: { id: true, openedAt: true, closedAt: true },
  });
  if (!shift) {
    return NextResponse.json({ error: "Зміну не знайдено" }, { status: 404 });
  }

  const parseDate = (v: unknown): Date | null | undefined => {
    if (v === undefined) return undefined; // поле не передали — не чіпаємо
    if (v === null || v === "") return null;
    const d = new Date(v as string);
    return isNaN(d.getTime()) ? undefined : d;
  };

  const openedAt = parseDate(body.openedAt);
  const closedAt = parseDate(body.closedAt);

  if (body.openedAt !== undefined && openedAt == null) {
    return NextResponse.json(
      { error: "Час відкриття обов'язковий і має бути коректним" },
      { status: 400 }
    );
  }
  if (body.closedAt !== undefined && body.closedAt && closedAt === undefined) {
    return NextResponse.json({ error: "Некоректний час закриття" }, { status: 400 });
  }

  const finalOpened = openedAt ?? shift.openedAt;
  const finalClosed = closedAt === undefined ? shift.closedAt : closedAt;

  if (finalClosed && finalClosed < finalOpened) {
    return NextResponse.json(
      { error: "Закриття не може бути раніше за відкриття" },
      { status: 400 }
    );
  }

  const updated = await prisma.warehouseShift.update({
    where: { id },
    data: {
      openedAt: finalOpened,
      closedAt: finalClosed,
      // Зміна без закриття лишається відкритою; проставили закриття — CLOSED
      status: finalClosed ? "CLOSED" : "OPEN",
      durationMinutes: finalClosed
        ? Math.max(0, Math.round((finalClosed.getTime() - finalOpened.getTime()) / 60000))
        : null,
      ...(body.notes !== undefined
        ? { notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null }
        : {}),
    },
  });

  return NextResponse.json(updated);
}

/**
 * Видалити зміну (лише ADMIN).
 *
 * Накладні зміни НЕ видаляємо — у схемі shiftId має onDelete: SetNull, тож
 * фото й розпізнані позиції лишаються в системі й просто стають «поза зміною».
 * Це навмисно: помилковий час зміни не привід втрачати документи.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const shift = await prisma.warehouseShift.findUnique({
    where: { id },
    select: { id: true, _count: { select: { reports: true } } },
  });
  if (!shift) {
    return NextResponse.json({ error: "Зміну не знайдено" }, { status: 404 });
  }

  await prisma.warehouseShift.delete({ where: { id } });

  return NextResponse.json({ ok: true, detachedReports: shift._count.reports });
}
