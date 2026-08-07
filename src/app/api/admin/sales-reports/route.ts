import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart, kyivDayEnd, kyivHour } from "@/lib/date/kyiv";

/**
 * Аналітика «Звіти торгових».
 * Агрегація в JS після одного Promise.all — той самий підхід, що в
 * /api/admin/warehouse-reports. Лише читання.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const repId = searchParams.get("repId");

  const period =
    from || to
      ? {
          ...(from && { gte: kyivDayStart(from) }),
          ...(to && { lte: kyivDayEnd(to) }),
        }
      : undefined;

  const repFilter = repId && repId !== "ALL" ? { userId: repId } : {};

  const [trips, checkpoints, repsList] = await Promise.all([
    prisma.salesTrip.findMany({
      where: {
        ...(period ? { startedAt: period } : {}),
        ...repFilter,
      },
      include: {
        user: { select: { id: true, name: true, telegramUsername: true } },
        checkpoints: { orderBy: { seq: "asc" } },
      },
      orderBy: { startedAt: "desc" },
    }),
    prisma.salesCheckpoint.findMany({
      where: {
        ...(period ? { createdAt: period } : {}),
        ...repFilter,
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({
      where: { role: "SALES" },
      select: { id: true, name: true, telegramId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // ---- Агрегація по торгових ----
  type RepAgg = {
    id: string;
    name: string;
    telegramUsername: string | null;
    tripsCount: number;
    closedCount: number;
    abandonedCount: number;
    openCount: number;
    days: Set<string>;
    totalKm: number;
    tripsWithKm: number;
    checkpointsCount: number;
    totalMinutes: number;
    firstCheckpointMinutes: number[];
    gapMinutes: number[];
    startHours: number[];
    suspiciousCount: number;
    manualOdometerCount: number;
    odometerReadings: number;
    onTrip: boolean;
  };

  const byRep = new Map<string, RepAgg>();

  const ensureRep = (id: string, name: string, username: string | null): RepAgg => {
    let agg = byRep.get(id);
    if (!agg) {
      agg = {
        id,
        name,
        telegramUsername: username,
        tripsCount: 0,
        closedCount: 0,
        abandonedCount: 0,
        openCount: 0,
        days: new Set(),
        totalKm: 0,
        tripsWithKm: 0,
        checkpointsCount: 0,
        totalMinutes: 0,
        firstCheckpointMinutes: [],
        gapMinutes: [],
        startHours: [],
        suspiciousCount: 0,
        manualOdometerCount: 0,
        odometerReadings: 0,
        onTrip: false,
      };
      byRep.set(id, agg);
    }
    return agg;
  };

  trips.forEach((t) => {
    const agg = ensureRep(t.userId, t.user.name, t.user.telegramUsername);

    agg.tripsCount += 1;
    agg.days.add(kyivDate(t.startedAt));
    agg.startHours.push(kyivHour(t.startedAt));

    if (t.status === "CLOSED") agg.closedCount += 1;
    if (t.status === "ABANDONED") agg.abandonedCount += 1;
    if (t.status === "OPEN") {
      agg.openCount += 1;
      agg.onTrip = true;
    }

    if (t.distanceKm != null) {
      agg.totalKm += t.distanceKm;
      agg.tripsWithKm += 1;
    }
    if (t.durationMinutes != null) agg.totalMinutes += t.durationMinutes;
    if (t.odometerSuspicious) agg.suspiciousCount += 1;

    // Якість AI: скільки показань довелося вводити руками чи виправляти
    [t.startOdometerSource, t.endOdometerSource].forEach((src) => {
      if (!src) return;
      agg.odometerReadings += 1;
      if (src === "MANUAL" || src === "CORRECTED") agg.manualOdometerCount += 1;
    });

    agg.checkpointsCount += t.checkpoints.length;
    t.checkpoints.forEach((c) => {
      if (c.minutesFromPrev == null) return;
      if (c.seq === 1) agg.firstCheckpointMinutes.push(c.minutesFromPrev);
      else agg.gapMinutes.push(c.minutesFromPrev);
    });
  });

  const avg = (nums: number[]): number | null =>
    nums.length ? Math.round(nums.reduce((s, n) => s + n, 0) / nums.length) : null;

  const workers = Array.from(byRep.values())
    .map((a) => {
      const daysWorked = a.days.size || 1;
      const hours = a.totalMinutes / 60;
      return {
        id: a.id,
        name: a.name,
        telegramUsername: a.telegramUsername,
        onTrip: a.onTrip,
        tripsCount: a.tripsCount,
        closedCount: a.closedCount,
        abandonedCount: a.abandonedCount,
        daysWorked: a.days.size,
        totalKm: a.totalKm,
        kmPerDay: Math.round(a.totalKm / daysWorked),
        checkpointsCount: a.checkpointsCount,
        checkpointsPerDay: Number((a.checkpointsCount / daysWorked).toFixed(1)),
        // Найцінніша метрика: високе значення = багато катається
        // заради малої кількості візитів.
        kmPerCheckpoint: a.checkpointsCount
          ? Math.round(a.totalKm / a.checkpointsCount)
          : null,
        totalHours: Number(hours.toFixed(1)),
        avgTripHours: a.tripsCount ? Number((hours / a.tripsCount).toFixed(1)) : 0,
        avgFirstCheckpointMinutes: avg(a.firstCheckpointMinutes),
        avgGapMinutes: avg(a.gapMinutes),
        avgStartHour: avg(a.startHours),
        suspiciousCount: a.suspiciousCount,
        manualOdometerRate: a.odometerReadings
          ? Math.round((a.manualOdometerCount / a.odometerReadings) * 100)
          : null,
      };
    })
    .sort((a, b) => b.totalKm - a.totalKm);

  // ---- Середнє по команді ----
  const teamAvg = workers.length
    ? {
        kmPerDay: Math.round(workers.reduce((s, w) => s + w.kmPerDay, 0) / workers.length),
        checkpointsPerDay: Number(
          (workers.reduce((s, w) => s + w.checkpointsPerDay, 0) / workers.length).toFixed(1)
        ),
        kmPerCheckpoint: (() => {
          const vals = workers.filter((w) => w.kmPerCheckpoint != null);
          return vals.length
            ? Math.round(vals.reduce((s, w) => s + (w.kmPerCheckpoint || 0), 0) / vals.length)
            : null;
        })(),
        avgTripHours: Number(
          (workers.reduce((s, w) => s + w.avgTripHours, 0) / workers.length).toFixed(1)
        ),
      }
    : null;

  // ---- Денна динаміка ----
  const dailyMap = new Map<string, { date: string; km: number; trips: number; checkpoints: number }>();
  trips.forEach((t) => {
    const date = kyivDate(t.startedAt);
    const row = dailyMap.get(date) || { date, km: 0, trips: 0, checkpoints: 0 };
    row.trips += 1;
    row.km += t.distanceKm || 0;
    row.checkpoints += t.checkpoints.length;
    dailyMap.set(date, row);
  });
  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // ---- Розподіл точок по годинах доби ----
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  checkpoints.forEach((c) => {
    hourly[kyivHour(c.createdAt)].count += 1;
  });

  // ---- KPI ----
  const closedTrips = trips.filter((t) => t.status === "CLOSED");
  const kpis = {
    tripsCount: trips.length,
    closedCount: closedTrips.length,
    openCount: trips.filter((t) => t.status === "OPEN").length,
    abandonedCount: trips.filter((t) => t.status === "ABANDONED").length,
    totalKm: trips.reduce((s, t) => s + (t.distanceKm || 0), 0),
    checkpointsCount: checkpoints.length,
    totalHours: Number(
      (trips.reduce((s, t) => s + (t.durationMinutes || 0), 0) / 60).toFixed(1)
    ),
    repsCount: byRep.size,
    suspiciousCount: trips.filter((t) => t.odometerSuspicious).length,
  };

  return NextResponse.json({
    kpis,
    workers,
    teamAvg,
    daily,
    hourly,
    repsList,
    trips: trips.map((t) => ({
      id: t.id,
      userId: t.userId,
      userName: t.user.name,
      status: t.status,
      startedAt: t.startedAt,
      startAddress: t.startAddress,
      startLat: t.startLat,
      startLng: t.startLng,
      startOdometer: t.startOdometer,
      startOdometerSource: t.startOdometerSource,
      startPhotoUrl: t.startPhotoUrl,
      endedAt: t.endedAt,
      endAddress: t.endAddress,
      endLat: t.endLat,
      endLng: t.endLng,
      endOdometer: t.endOdometer,
      endOdometerSource: t.endOdometerSource,
      endPhotoUrl: t.endPhotoUrl,
      distanceKm: t.distanceKm,
      durationMinutes: t.durationMinutes,
      checkpointsCount: t.checkpoints.length,
      odometerSuspicious: t.odometerSuspicious,
      checkpoints: t.checkpoints.map((c) => ({
        id: c.id,
        seq: c.seq,
        lat: c.lat,
        lng: c.lng,
        address: c.address,
        createdAt: c.createdAt,
        minutesFromPrev: c.minutesFromPrev,
        metersFromPrev: c.metersFromPrev,
      })),
    })),
    checkpoints: checkpoints.map((c) => ({
      id: c.id,
      tripId: c.tripId,
      userName: c.user.name,
      seq: c.seq,
      lat: c.lat,
      lng: c.lng,
      address: c.address,
      createdAt: c.createdAt,
      minutesFromPrev: c.minutesFromPrev,
      metersFromPrev: c.metersFromPrev,
    })),
  });
}
