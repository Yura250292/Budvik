/**
 * Одна зміна повністю: обидва фото одометра, трек на карті, звірка.
 *
 * Трек віддається двома шарами. Робочий (SHIFT) — те, за що платять.
 * Пост-змінний (AFTER_SHIFT) — поїздки після закриття зміни, які
 * пристрій зафіксував, бо машина від'їхала більш ніж на кілометр.
 * Змішувати їх в одну лінію не можна: висновок з них різний.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildTrackPath } from "@/lib/track/gaps";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "MANAGER"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { id } = await params;

  const shift = await prisma.shift.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, role: true } },
      reads: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          phase: true,
          photoUrl: true,
          aiValue: true,
          aiConfidence: true,
          aiDigitsRead: true,
          aiIsTripMeter: true,
          rejectedReason: true,
          createdAt: true,
        },
      },
    },
  });

  if (!shift) return NextResponse.json({ error: "Зміну не знайдено" }, { status: 404 });

  const points = await prisma.trackPoint.findMany({
    where: { shiftId: id },
    orderBy: { recordedAt: "asc" },
    select: {
      lat: true,
      lng: true,
      recordedAt: true,
      speedKmh: true,
      accuracyM: true,
      gapGeometry: true,
      phase: true,
    },
  });

  const shiftPoints = points.filter((p) => p.phase !== "AFTER_SHIFT");
  const afterPoints = points.filter((p) => p.phase === "AFTER_SHIFT");

  /**
   * Скільки разів торговий перезнімав панель.
   *
   * Одне-два — нормально (відблиск, темно). Систематичні п'ять спроб —
   * привід глянути, чи не підбиралося «зручне» число.
   */
  const attempts = {
    start: shift.reads.filter((r) => r.phase === "START").length,
    end: shift.reads.filter((r) => r.phase === "END").length,
  };

  return NextResponse.json({
    shift: {
      ...shift,
      user: undefined,
      reads: undefined,
    },
    user: shift.user,
    reads: shift.reads,
    attempts,
    track: {
      shift: {
        points: shiftPoints,
        path: buildTrackPath(shiftPoints),
        pointsCount: shiftPoints.length,
      },
      afterShift: {
        points: afterPoints,
        path: buildTrackPath(afterPoints),
        pointsCount: afterPoints.length,
      },
    },
  });
}
