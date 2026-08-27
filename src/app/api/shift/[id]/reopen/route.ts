/**
 * «Я ще працюю» — повернення автоматично закритої зміни в роботу.
 *
 * Автозакриття помиляється в один бік: машина довго стоїть біля
 * клієнта, а система вирішує, що день скінчився. Без цієї кнопки людині
 * лишалося б відкрити НОВУ зміну — і день розпадався б надвоє, з чужим
 * стартовим одометром і подвійною подачею в плані.
 *
 * Вікно вузьке навмисно (REOPEN_WINDOW_HOURS): це виправлення свіжої
 * помилки, а не спосіб переписати вчорашній день.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";
import { REOPEN_WINDOW_HOURS } from "@/lib/shift/confirm";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  const shift = await prisma.shift.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      status: true,
      endedAt: true,
      endOdometer: true,
      closedAutomatically: true,
    },
  });

  if (!shift) return NextResponse.json({ error: "Зміну не знайдено" }, { status: 404 });
  if (shift.userId !== auth.me.userId) {
    return NextResponse.json({ error: "Це чужа зміна" }, { status: 403 });
  }
  if (shift.status === "OPEN") {
    return NextResponse.json({ shift, repeated: true });
  }

  /**
   * Повернути можна лише те, що закрив автомат. Зміну, яку людина
   * закрила сама фото одометра, «відкривати назад» немає сенсу: у неї
   * вже є чесний кінцевий одометр.
   */
  if (!shift.closedAutomatically || shift.endOdometer != null) {
    return NextResponse.json(
      { error: "Цю зміну закрили не автоматично — поверненню не підлягає" },
      { status: 409 }
    );
  }

  const closedAgo = shift.endedAt ? Date.now() - shift.endedAt.getTime() : Infinity;
  if (closedAgo > REOPEN_WINDOW_HOURS * 3_600_000) {
    return NextResponse.json(
      { error: `Повернути зміну можна протягом ${REOPEN_WINDOW_HOURS} годин після закриття` },
      { status: 409 }
    );
  }

  try {
    const reopened = await prisma.shift.update({
      where: { id: shift.id },
      data: {
        status: "OPEN",
        endedAt: null,
        durationMinutes: null,
        closedLate: false,
        lateCloseSource: null,
        closedAutomatically: false,
        afterWorkKm: null,
        // Підозру знімаємо: причиною була саме відсутність одометра, а
        // зміна знову йде звичайним шляхом — із фінішним фото.
        odometerSuspicious: false,
        notes: null,
      },
    });
    return NextResponse.json({ shift: reopened });
  } catch (e) {
    /**
     * Частковий унікальний індекс «одна OPEN на людину». Якщо людина
     * встигла відкрити нову зміну, повертати стару нікуди — і це не
     * збій, а нормальна відмова.
     */
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "У вас уже відкрита інша зміна" },
        { status: 409 }
      );
    }
    throw e;
  }
}
