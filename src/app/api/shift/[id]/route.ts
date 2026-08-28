/**
 * Одна зміна очима самого торгового.
 *
 * Не полегшена копія адмінського `/api/admin/shifts/[id]`: там зміну
 * порівнюють із планом, з подачею, із замовленнями дня — це робота офіса.
 * Тут питання інше й одне: «звідки взялося число, за яке мені платять».
 * Тому віддаємо рівно те, з чого воно склалося — обидва фото одометра,
 * пробіг за приладом і за GPS, відняту дорогу додому, ким і коли зміну
 * закрито й підтверджено.
 *
 * Завжди СВОЯ зміна: userId береться з токена, і параметра «чия» тут немає.
 * Керівник дивиться чужі зміни в адмінці, де для цього є і права, і контекст.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";
import { buildTrackPath } from "@/lib/track/gaps";

export const dynamic = "force-dynamic";

/**
 * Скільки вершин лишаємо в лінії треку.
 *
 * Її малюють у прямокутнику 150 px заввишки — там і сотня точок уже зайва.
 * А от повні півтори тисячі важать під сотню кілобайт, і вантажити їх на
 * маршруті, де мережі ледве вистачає на відмітку візиту, немає за що.
 */
const PATH_VERTICES = 160;

/** Рівномірне проріджування: форма лінії зберігається, кінці лишаються на місці. */
function thin<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  const step = (items.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, i) => items[Math.round(i * step)]);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const shift = await prisma.shift.findFirst({
    where: { id, userId: auth.me.userId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      startOdometer: true,
      endOdometer: true,
      startPhotoUrl: true,
      endPhotoUrl: true,
      distanceKm: true,
      durationMinutes: true,
      gpsDistanceKm: true,
      odometerToGpsRatio: true,
      personalKm: true,
      afterWorkKm: true,
      odometerSuspicious: true,
      closedAutomatically: true,
      closedLate: true,
      lateCloseSource: true,
      confirmedAt: true,
      confirmSource: true,
      autoClosedByShiftId: true,
      notes: true,
    },
  });

  if (!shift) return NextResponse.json({ error: "Зміну не знайдено" }, { status: 404 });

  /**
   * Звідки взявся кінцевий одометр, якщо фінішного фото немає.
   *
   * Забуту зміну закриває наступна: її ранкове фото і є показанням на
   * кінець вчорашнього дня. Без цього рядка число на екрані виглядає
   * взятим зі стелі — а це рівно те число, з якого рахують зарплату.
   */
  const closedBy = shift.autoClosedByShiftId
    ? await prisma.shift.findUnique({
        where: { id: shift.autoClosedByShiftId },
        select: { startedAt: true },
      })
    : null;

  const points = await prisma.trackPoint.findMany({
    where: { shiftId: id },
    orderBy: { recordedAt: "asc" },
    select: { lat: true, lng: true, accuracyM: true, gapGeometry: true, phase: true },
  });

  const work = points.filter((p) => p.phase !== "AFTER_SHIFT");
  const after = points.filter((p) => p.phase === "AFTER_SHIFT");

  return NextResponse.json({
    shift: {
      ...shift,
      autoClosedByShiftId: undefined,
      /** Кінцеве показання порахувалося з ранкового фото наступної зміни. */
      endOdometerFromNextShiftAt: shift.endPhotoUrl == null ? (closedBy?.startedAt ?? null) : null,
    },
    track: {
      pointsCount: work.length,
      afterPointsCount: after.length,
      path: thin(buildTrackPath(work), PATH_VERTICES),
    },
  });
}
