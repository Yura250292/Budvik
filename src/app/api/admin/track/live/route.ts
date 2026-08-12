/**
 * Хто зараз на маршруті — для карти керівника.
 *
 * Запит навмисно легкий: усе, що потрібно, лежить у TrackSession
 * (lastPointAt, лічильники), і таблиця точок не сканується взагалі.
 * Сторінка опитує цей ендпоінт раз на 20–30 секунд, тож він мусить
 * коштувати як один індексний скан.
 *
 * Остання координата все ж потрібна — беремо її одним запитом на всіх
 * через DISTINCT ON, а не N+1 підзапитами.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "MANAGER"];

/** Скільки хвилин без точки, щоб вважати трек обірваним. */
const ONLINE_WINDOW_MIN = 10;

type LiveRow = {
  userId: string;
  name: string;
  role: string;
  color: string | null;
  lat: number;
  lng: number;
  speedKmh: number | null;
  recordedAt: Date;
  distanceKm: number;
  pointsCount: number;
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const url = new URL(req.url);
  const day = url.searchParams.get("day") || kyivDate(new Date());
  const dayStart = kyivDayStart(day);

  const rows = await prisma.$queryRaw<LiveRow[]>`
    SELECT DISTINCT ON (s."userId")
           s."userId",
           u.name,
           u.role::text AS role,
           u.color,
           p.lat,
           p.lng,
           p."speedKmh",
           p."recordedAt",
           s."distanceKm"::float AS "distanceKm",
           s."pointsCount"
    FROM "TrackSession" s
    JOIN "User" u ON u.id = s."userId"
    JOIN "TrackPoint" p ON p."sessionId" = s.id
    WHERE s.day = ${dayStart}
    ORDER BY s."userId", p."recordedAt" DESC
  `;

  const now = Date.now();

  return NextResponse.json({
    day,
    people: rows.map((r) => {
      const minutesAgo = Math.floor((now - r.recordedAt.getTime()) / 60_000);
      return {
        userId: r.userId,
        name: r.name,
        role: r.role,
        color: r.color,
        lat: r.lat,
        lng: r.lng,
        speedKmh: r.speedKmh,
        lastPointAt: r.recordedAt,
        minutesAgo,
        online: minutesAgo <= ONLINE_WINDOW_MIN,
        distanceKm: Math.round(r.distanceKm * 10) / 10,
        pointsCount: r.pointsCount,
      };
    }),
  });
}
