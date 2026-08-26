/**
 * Самоперевірка треку за день: чи писався він рівно, чи з дірками.
 *
 * Потрібна саме на час обкатки застосунку. Карта показує лінію, і лінія
 * майже завжди виглядає правдоподібно — навіть коли половину дня
 * пристрій мовчав, а сусідні точки просто з'єдналися прямою. Тут
 * навпаки: цифри, за якими видно, що саме пішло не так.
 *
 * Питання, на які відповідає: чи були довгі паузи (і коли), чи не збився
 * годинник на пристрої, яка точність GPS, чи доходили пачки регулярно.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayStart } from "@/lib/date/kyiv";
import { onlyWorkingHours, WORK_HOURS_LABEL } from "@/lib/track/work-hours";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["ADMIN", "MANAGER"];

/**
 * Пауза, з якої вважаємо, що зв'язку не було.
 *
 * Планшет шле точку раз на хвилину, застосунок — теж. П'ять хвилин без
 * жодної точки — це вже не «не встиг», а провал: або служба спала, або
 * GPS не бачив неба, або пристрій вимкнули.
 */
const GAP_MINUTES = 5;

/** Похибка, за якої точка ще щось доводить (та сама, що при прийомі). */
const GOOD_ACCURACY_M = 100;

/**
 * Пауза в пульсі, з якої вважаємо, що застосунок не працював.
 *
 * Пульс іде раз на 3 хвилини; 10 — це три пропущені поспіль, тобто вже
 * не затримка мережі, а зупинена служба.
 */
const HEARTBEAT_GAP_MINUTES = 10;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Не авторизовано" }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role)) {
    return NextResponse.json({ error: "Немає доступу" }, { status: 403 });
  }

  const { userId } = await params;
  const url = new URL(req.url);
  const day = url.searchParams.get("day") || kyivDate(new Date());
  const dayStart = kyivDayStart(day);

  const [user, trackSession, allPoints, beats, devices] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true },
    }),
    prisma.trackSession.findUnique({
      where: { userId_day: { userId, day: dayStart } },
      select: { startedAt: true, lastPointAt: true, pointsCount: true, distanceKm: true },
    }),
    prisma.trackPoint.findMany({
      where: { userId, session: { day: dayStart } },
      orderBy: { recordedAt: "asc" },
      select: { recordedAt: true, createdAt: true, accuracyM: true, speedKmh: true },
    }),
    /**
     * Пульс за цю добу.
     *
     * Це друга половина відповіді на «чому немає треку». Точки кажуть,
     * що записалось; пульс — що при цьому діялось із самим застосунком.
     * Дірка в точках при рівному пульсі означає «GPS не бачив неба», а
     * дірка в обох — «служби не було». Раніше ці дві різні біди були
     * нерозрізненні.
     */
    prisma.deviceHeartbeat.findMany({
      where: { userId, at: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } },
      orderBy: { at: "asc" },
      select: {
        at: true,
        tracking: true,
        mode: true,
        buffered: true,
        lastFixAt: true,
        lastFixAccuracyM: true,
        lastError: true,
        locationPermission: true,
        locationMode: true,
        batteryOptimized: true,
        batteryPct: true,
        appVersion: true,
        deviceName: true,
      },
    }),
    // Пристрої цієї людини: якщо точок немає, перше питання — чи взагалі
    // хтось логінився і коли пристрій востаннє озивався.
    prisma.deviceToken.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        deviceName: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    }),
  ]);

  if (!user) {
    return NextResponse.json({ error: "Користувача не знайдено" }, { status: 404 });
  }

  /**
   * Рахуємо якість лише по робочих годинах.
   *
   * Інакше нічна пауза (пристрій лежить удома, служба зупинена) лягла б
   * у статистику як багатогодинна дірка, і покриття завжди виглядало б
   * жахливо навіть при бездоганній роботі застосунку.
   */
  const points = onlyWorkingHours(allPoints);
  const hiddenPoints = allPoints.length - points.length;

  const gaps: Array<{ from: string; to: string; minutes: number }> = [];
  let goodAccuracy = 0;
  let accuracySum = 0;
  let accuracyKnown = 0;
  let maxLagSeconds = 0;
  let movingPoints = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];

    if (p.accuracyM != null) {
      accuracyKnown++;
      accuracySum += p.accuracyM;
      if (p.accuracyM <= GOOD_ACCURACY_M) goodAccuracy++;
    }
    if ((p.speedKmh ?? 0) > 5) movingPoints++;

    /**
     * Затримка доставки: скільки точка пролежала в буфері пристрою до
     * запису в базу. Велика затримка — не помилка (так і задумано в
     * офлайні), але вона показує, де саме зв'язку не було.
     */
    const lag = (p.createdAt.getTime() - p.recordedAt.getTime()) / 1000;
    if (lag > maxLagSeconds) maxLagSeconds = lag;

    if (i > 0) {
      const minutes =
        (p.recordedAt.getTime() - points[i - 1].recordedAt.getTime()) / 60_000;
      if (minutes >= GAP_MINUTES) {
        gaps.push({
          from: points[i - 1].recordedAt.toISOString(),
          to: p.recordedAt.toISOString(),
          minutes: Math.round(minutes),
        });
      }
    }
  }

  const first = points[0]?.recordedAt ?? null;
  const last = points[points.length - 1]?.recordedAt ?? null;
  const spanMinutes =
    first && last ? Math.round((last.getTime() - first.getTime()) / 60_000) : 0;
  const gapMinutes = gaps.reduce((s, g) => s + g.minutes, 0);

  /**
   * Головна цифра сторінки. Скільки часу від першої до останньої точки
   * пристрій справді писав — решта провалилася в дірки. Саме її й треба
   * порівнювати з ботом: там вона рідко бувала високою.
   */
  const coverage =
    spanMinutes > 0 ? Math.round(((spanMinutes - gapMinutes) / spanMinutes) * 100) : null;

  /**
   * Годинник пристрою. Якщо він збігся, точки «з майбутнього» ламають
   * усе: сервер відсіює їх як stale, і трек мовчки коротшає. Дешева
   * перевірка, яка рятує від довгого пошуку причини.
   */
  const clockSkewSeconds = points.length
    ? Math.round(
        Math.min(...points.map((p) => (p.createdAt.getTime() - p.recordedAt.getTime()) / 1000))
      )
    : null;

  /**
   * Мовчання пульсу — це і є «застосунок не працював».
   *
   * Пульс іде раз на 3 хвилини, тож пауза від 10 хвилин означає, що
   * служби в цей час не було: вбита системою, вимкнений планшет або
   * знята задача. Саме ці інтервали й пояснюють дірки в треку.
   */
  const beatGaps: Array<{ from: string; to: string; minutes: number }> = [];
  for (let i = 1; i < beats.length; i++) {
    const minutes = (beats[i].at.getTime() - beats[i - 1].at.getTime()) / 60_000;
    if (minutes >= HEARTBEAT_GAP_MINUTES) {
      beatGaps.push({
        from: beats[i - 1].at.toISOString(),
        to: beats[i].at.toISOString(),
        minutes: Math.round(minutes),
      });
    }
  }

  const lastBeat = beats[beats.length - 1] ?? null;

  return NextResponse.json({
    day,
    user,
    hasTrack: points.length > 0,
    workHours: WORK_HOURS_LABEL,
    /** Точки поза робочим вікном: записані, але в статистику не йдуть */
    hiddenPoints,
    summary: {
      pointsCount: points.length,
      distanceKm: trackSession ? Math.round(trackSession.distanceKm * 10) / 10 : 0,
      firstAt: first?.toISOString() ?? null,
      lastAt: last?.toISOString() ?? null,
      spanMinutes,
      coverage,
      /** Скільки хвилин пристрій мовчав сумарно */
      gapMinutes,
      gapsCount: gaps.length,
      /** Середній проміжок між точками — очікуємо близько 1 хв */
      avgIntervalSec:
        points.length > 1 ? Math.round((spanMinutes * 60) / (points.length - 1)) : null,
      accuracyAvgM: accuracyKnown ? Math.round(accuracySum / accuracyKnown) : null,
      goodAccuracyPct: accuracyKnown
        ? Math.round((goodAccuracy / accuracyKnown) * 100)
        : null,
      movingPct: points.length ? Math.round((movingPoints / points.length) * 100) : null,
      maxDeliveryLagMin: Math.round(maxLagSeconds / 60),
      clockSkewSeconds,
    },
    /** Найдовші паузи — саме їх дивляться першими */
    gaps: gaps.sort((a, b) => b.minutes - a.minutes).slice(0, 10),
    /**
     * Що застосунок казав про себе. null — пульсу не було зовсім:
     * або на планшеті стара збірка, або він не запускався.
     */
    device: lastBeat
      ? {
          at: lastBeat.at.toISOString(),
          tracking: lastBeat.tracking,
          mode: lastBeat.mode,
          buffered: lastBeat.buffered,
          lastFixAt: lastBeat.lastFixAt?.toISOString() ?? null,
          lastFixAccuracyM: lastBeat.lastFixAccuracyM,
          lastError: lastBeat.lastError,
          locationPermission: lastBeat.locationPermission,
          locationMode: lastBeat.locationMode,
          batteryOptimized: lastBeat.batteryOptimized,
          batteryPct: lastBeat.batteryPct,
          appVersion: lastBeat.appVersion,
          deviceName: lastBeat.deviceName,
        }
      : null,
    /** Скільки разів застосунок озвався за день і коли мовчав. */
    heartbeat: {
      count: beats.length,
      firstAt: beats[0]?.at.toISOString() ?? null,
      lastAt: lastBeat?.at.toISOString() ?? null,
      silentMinutes: beatGaps.reduce((sum, g) => sum + g.minutes, 0),
      gaps: beatGaps.sort((a, b) => b.minutes - a.minutes).slice(0, 10),
    },
    devices: devices.map((d) => ({
      deviceName: d.deviceName,
      lastUsedAt: d.lastUsedAt?.toISOString() ?? null,
      revoked: d.revokedAt != null,
      createdAt: d.createdAt.toISOString(),
    })),
  });
}
