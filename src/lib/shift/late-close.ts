/**
 * Пізнє закриття зміни: коли фото одометра зробити вже нема як.
 *
 * Сценарій із життя: торговий закінчив об'їзд, приїхав додому, а зміну
 * закрити забув. Згадав увечері — але машина у дворі, і на одометрі вже
 * інше число: у нього ввійшла дорога додому й вечірня поїздка в магазин.
 *
 * Одометр тут уже не врятувати — він прийде зранку зі старту наступної
 * зміни. Але час закінчення роботи людина пам'ятає, а трек за той день
 * лежить у базі. Цього досить, щоб відділити робочі кілометри від
 * вечірніх: одометр знає лише підсумок, а GPS — коли саме машина стала.
 */

import { prisma } from "@/lib/prisma";
import { haversineM } from "@/lib/track/geo";

/**
 * Скільки хвилин без руху вважаємо «робота скінчилася».
 *
 * 40 хвилин: обід і довга розмова в клієнта в це не вкладаються, а
 * приїзд додому — так. Менший поріг ловив би кожну зупинку на каву й
 * пропонував би закінчити зміну опівдні.
 */
const STOP_MINUTES = 40;

/** Зсув, менший за який вважаємо, що машина стоїть, а не їде. */
const STOP_RADIUS_M = 300;

export type StopGuess = {
  /** Коли машина стала надовго — пропозиція для «час закінчення» */
  at: Date;
  /** Скільки простояла до кінця треку, хвилин */
  minutes: number;
  lat: number;
  lng: number;
};

/**
 * Знаходить останню довгу зупинку в треку зміни.
 *
 * Шукаємо саме ОСТАННЮ: за день таких зупинок кілька (обід, склад), а
 * нас цікавить та, після якої рух уже не відновився по-робочому.
 */
export async function guessWorkEnd(shiftId: string): Promise<StopGuess | null> {
  const points = await prisma.trackPoint.findMany({
    where: { shiftId },
    orderBy: { recordedAt: "asc" },
    select: { lat: true, lng: true, recordedAt: true },
  });

  if (points.length < 3) return null;

  let best: StopGuess | null = null;
  let anchorIdx = 0;

  for (let i = 1; i < points.length; i++) {
    const moved = haversineM(
      points[anchorIdx].lat,
      points[anchorIdx].lng,
      points[i].lat,
      points[i].lng
    );

    if (moved > STOP_RADIUS_M) {
      // Поїхали далі — рахуємо, скільки простояли на попередньому місці.
      const stoodMin =
        (points[i - 1].recordedAt.getTime() - points[anchorIdx].recordedAt.getTime()) / 60_000;
      if (stoodMin >= STOP_MINUTES) {
        best = {
          at: points[anchorIdx].recordedAt,
          minutes: Math.round(stoodMin),
          lat: points[anchorIdx].lat,
          lng: points[anchorIdx].lng,
        };
      }
      anchorIdx = i;
    }
  }

  // Хвіст треку: машина стала й більше не рушила — найімовірніший
  // кандидат, бо саме так виглядає «приїхав додому».
  const last = points[points.length - 1];
  const tailMin =
    (last.recordedAt.getTime() - points[anchorIdx].recordedAt.getTime()) / 60_000;
  if (tailMin >= STOP_MINUTES) {
    best = {
      at: points[anchorIdx].recordedAt,
      minutes: Math.round(tailMin),
      lat: points[anchorIdx].lat,
      lng: points[anchorIdx].lng,
    };
  }

  return best;
}

/**
 * Кілометри за GPS у заданому проміжку зміни.
 *
 * Потрібно двічі: до endedAt — робочі, після — дорога додому й вечір.
 * Одометр такого розділення не дає в принципі, він знає лише підсумок
 * між двома фото.
 */
export async function gpsKmBetween(
  shiftId: string,
  from: Date | null,
  to: Date | null
): Promise<number | null> {
  const points = await prisma.trackPoint.findMany({
    where: {
      shiftId,
      ...(from || to
        ? { recordedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    },
    orderBy: { recordedAt: "asc" },
    select: { lat: true, lng: true, roadMetersFromPrev: true, metersFromPrev: true },
  });

  if (points.length < 2) return null;

  let meters = 0;
  for (let i = 1; i < points.length; i++) {
    // Там, де розрив добито реальною дорогою, беремо її: пряма через
    // півміста занижує пробіг саме на офлайнових ділянках.
    const road = points[i].roadMetersFromPrev;
    if (road != null) {
      meters += road;
      continue;
    }
    const straight = points[i].metersFromPrev;
    meters +=
      straight != null
        ? straight
        : haversineM(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
  }

  return Math.round(meters / 100) / 10;
}
