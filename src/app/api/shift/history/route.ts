/**
 * Історія власних змін для застосунку.
 *
 * Торговий бачить лише себе: userId береться з токена, а не з запиту.
 * Це не додаткова перевірка, а єдине джерело — параметра «чия історія»
 * тут просто немає.
 *
 * Потрібна не заради цікавості: одометр наступної зміни має продовжувати
 * попередню, і коли число не сходиться, першим ділом дивляться сюди.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRoles, FIELD_ROLES } from "@/lib/app/identity";

export const dynamic = "force-dynamic";

/** Скільки змін віддаємо за раз. Місяць роботи — приблизно стільки. */
const LIMIT = 30;

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, FIELD_ROLES);
  if (!auth.ok) return auth.response;
  const userId = auth.me.userId;

  const shifts = await prisma.shift.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      startOdometer: true,
      endOdometer: true,
      distanceKm: true,
      durationMinutes: true,
      gpsDistanceKm: true,
      personalKm: true,
      odometerSuspicious: true,
      closedAutomatically: true,
      startPhotoUrl: true,
      endPhotoUrl: true,
    },
  });

  /**
   * Підсумок за 30 днів — те, що торговий питає найчастіше: скільки
   * накатав за місяць. Рахуємо по закритих: у відкритої пробігу ще немає.
   */
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const recent = shifts.filter((s) => s.startedAt >= monthAgo && s.distanceKm != null);

  return NextResponse.json({
    shifts,
    summary: {
      count: recent.length,
      totalKm: recent.reduce((sum, s) => sum + (s.distanceKm ?? 0), 0),
      totalMinutes: recent.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0),
      // Скільки змін закрилися самі — торговому корисно бачити свою
      // дисципліну, а не дізнаватися про це від керівника.
      autoClosed: recent.filter((s) => s.closedAutomatically).length,
    },
  });
}

