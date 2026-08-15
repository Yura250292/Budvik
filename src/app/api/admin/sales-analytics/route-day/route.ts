/**
 * Маршрут торгового на конкретний день: план проти факту.
 *
 * План — шаблон із розкладу (RouteAssignment), факт — поїздка й чекпойнти
 * з Telegram-бота. Разом на одній мапі видно, чи проїхав торговий той
 * напрямок, який мав.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayEnd, kyivDayStart, kyivTime } from "@/lib/date/kyiv";
import { resolveRouteForDay } from "@/lib/routes/resolve";
import { comparePlanWithTrack } from "@/lib/track/plan-vs-fact";

export const dynamic = "force-dynamic";

const FULL_ACCESS_ROLES = ["ADMIN", "MANAGER"];

type Excursion = {
  from: string;
  to: string;
  minutes: number;
  km: number;
  maxDistanceM: number;
  lat: number;
  lng: number;
};

/**
 * Скільки точок треку віддавати на мапу.
 *
 * За день їх буває 150–200 на поїздку, а на екрані 4000×2000 різниця між
 * 200 і 800 точками невидима. Ліміт захищає не мапу, а payload: кілька
 * поїздок по кілька сотень точок перетворюють відповідь на мегабайти.
 */
const MAX_TRACK_POINTS = 400;

/**
 * Рівномірне проріджування. Перша й остання точки зберігаються завжди —
 * інакше лінія на мапі починалася б і закінчувалася не там, де поїздка.
 */
function thinTrack(points: Array<{ lat: number; lng: number }>) {
  if (points.length <= MAX_TRACK_POINTS) {
    return points.map((p) => ({ lat: p.lat, lng: p.lng }));
  }

  const step = points.length / MAX_TRACK_POINTS;
  const out: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i < MAX_TRACK_POINTS; i++) {
    const p = points[Math.floor(i * step)];
    out.push({ lat: p.lat, lng: p.lng });
  }
  const last = points[points.length - 1];
  out.push({ lat: last.lat, lng: last.lng });
  return out;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }

  const role = session.user.role;
  const isFullAccess = FULL_ACCESS_ROLES.includes(role);
  if (!isFullAccess && role !== "SALES") {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const requestedRep = searchParams.get("repId");
  const repId = isFullAccess ? requestedRep : session.user.id;
  if (!repId) {
    return NextResponse.json({ error: "Потрібен repId" }, { status: 400 });
  }
  if (!isFullAccess && repId !== session.user.id) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const dayParam = searchParams.get("date");
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dayParam ?? "") ? dayParam! : kyivDate(new Date());

  const [planned, trips, rep] = await Promise.all([
    resolveRouteForDay(repId, day),
    prisma.salesTrip.findMany({
      where: {
        userId: repId,
        startedAt: { gte: kyivDayStart(day), lte: kyivDayEnd(day) },
      },
      include: {
        checkpoints: { orderBy: { seq: "asc" } },
        // Точок за день сотні. Тягнемо лише координати й час: адреси тут
        // не потрібні, а accuracy потрібна аналізу, не мапі.
        trackPoints: {
          orderBy: { recordedAt: "asc" },
          // accuracyM потрібна аналізу відхилень: погана точність
          // розширює коридор, щоб шум GPS не читався як виїзд убік.
          select: { lat: true, lng: true, recordedAt: true, accuracyM: true },
        },
      },
      orderBy: { startedAt: "asc" },
    }),
    prisma.user.findUnique({ where: { id: repId }, select: { id: true, name: true } }),
  ]);

  const actual = trips.map((t) => {
    /**
     * Відхилення рахуємо тут, а не читаємо з поїздки.
     *
     * Поля onRouteRatio/offRouteKm/excursions у SalesTrip існують з
     * самого початку, але їх ніхто ніколи не заповнював — код, який мав
     * рахувати їх при закритті поїздки, так і не написали. Тому в базі
     * там завжди null, і вся ця панель роками показувала нулі.
     *
     * Рахунок на льоту заразом лікує головну ваду збереженого результату:
     * маршрут можна перепризначити заднім числом, і стара цифра стала б
     * брехнею. Ціна — мілісекунди на сотні точок.
     */
    const live = comparePlanWithTrack(t.trackPoints, planned);
    const dev = live.deviation;

    return {
      id: t.id,
      status: t.status,
      startedAt: t.startedAt.toISOString(),
      startTime: kyivTime(t.startedAt),
      endedAt: t.endedAt?.toISOString() ?? null,
      endTime: t.endedAt ? kyivTime(t.endedAt) : null,
      distanceKm: t.distanceKm,
      durationMinutes: t.durationMinutes,
      trackDistanceKm: t.trackDistanceKm,
      trackMinutes: t.trackMinutes,
      trackCoverage: t.trackCoverage,
      // Порахованому щойно віддаємо перевагу; збережене лишається
      // запасним варіантом на випадок, якщо колись його почнуть писати.
      onRouteRatio: dev?.onRouteRatio ?? t.onRouteRatio,
      offRouteKm: dev?.offRouteKm ?? t.offRouteKm,
      // Час епізодів форматуємо тут: kyivTime живе на сервері, і тягнути
      // таймзонні перетворення в клієнт заради двох підписів немає сенсу.
      excursions: (dev
        ? dev.excursions.map((e) => ({
            ...e,
            from: e.from.toISOString(),
            to: e.to.toISOString(),
          }))
        : ((t.excursions as Excursion[] | null) ?? [])
      ).map((e) => ({
        ...e,
        fromTime: kyivTime(new Date(e.from)),
        toTime: kyivTime(new Date(e.to)),
      })),
      track: thinTrack(t.trackPoints),
      start: t.startLat != null && t.startLng != null
        ? { lat: t.startLat, lng: t.startLng, address: t.startAddress }
        : null,
      end: t.endLat != null && t.endLng != null
        ? { lat: t.endLat, lng: t.endLng, address: t.endAddress }
        : null,
      checkpoints: t.checkpoints.map((c) => ({
        id: c.id,
        lat: c.lat,
        lng: c.lng,
        address: c.address,
        seq: c.seq,
        time: kyivTime(c.createdAt),
        minutesFromPrev: c.minutesFromPrev,
      })),
    };
  });

  return NextResponse.json({
    day,
    rep,
    planned,
    trips: actual,
    summary: {
      tripsCount: actual.length,
      checkpointsCount: actual.reduce((s, t) => s + t.checkpoints.length, 0),
      distanceKm: actual.reduce((s, t) => s + (t.distanceKm ?? 0), 0),
      plannedStops: planned?.stops.length ?? 0,
      plannedKm: planned?.totalDistanceKm ?? null,
      trackKm: actual.reduce((s, t) => s + (t.trackDistanceKm ?? 0), 0),
      offRouteKm: actual.reduce((s, t) => s + (t.offRouteKm ?? 0), 0),
      excursionsCount: actual.reduce((s, t) => s + t.excursions.length, 0),
      /// Найгірше покриття за день: одна поїздка без треку знецінює решту
      minCoverage: actual.reduce<number | null>((min, t) => {
        if (t.trackCoverage == null) return min;
        return min == null ? t.trackCoverage : Math.min(min, t.trackCoverage);
      }, null),
    },
  });
}
