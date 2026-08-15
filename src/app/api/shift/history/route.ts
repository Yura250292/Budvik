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
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyDeviceToken, TRACK_ROLES } from "@/lib/track/device-token";

export const dynamic = "force-dynamic";

/** Скільки змін віддаємо за раз. Місяць роботи — приблизно стільки. */
const LIMIT = 30;

export async function GET(req: NextRequest) {
  const userId = await resolveUser(req);
  if (!userId) return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });

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

async function resolveUser(req: NextRequest): Promise<string | null> {
  const device = await verifyDeviceToken(req.headers.get("authorization"));
  if (device) return device.userId;
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  if (!TRACK_ROLES.includes(session.user.role)) return null;
  return session.user.id;
}
