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
export const STOP_MINUTES = 40;

/** Зсув, менший за який вважаємо, що машина стоїть, а не їде. */
const STOP_RADIUS_M = 300;

export type StopGuess = {
  /** Коли машина стала надовго — пропозиція для «час закінчення» */
  at: Date;
  /** Скільки простояла до кінця треку, хвилин */
  minutes: number;
  lat: number;
  lng: number;
  /**
   * Скільки хвилин трек мовчав БЕЗПОСЕРЕДНЬО перед цією зупинкою.
   *
   * Питання, на яке відповідає це число: чи бачили ми, як машина
   * ставала, — чи планшет ожив уже на місці. У другому випадку `at` не
   * момент зупинки, а лише її ВЕРХНЯ МЕЖА: робота могла скінчитися
   * будь-коли в тій дірі. Реальний випадок 27.08: трек мовчав з 09:13
   * до 16:05, і «машина стоїть з 16:05» звучало як вимір, хоча було
   * здогадкою на сім годин.
   */
  gapBeforeMin: number;
};

/**
 * Знаходить останню довгу зупинку в треку зміни.
 *
 * Шукаємо саме ОСТАННЮ: за день таких зупинок кілька (обід, склад), а
 * нас цікавить та, після якої рух уже не відновився по-робочому.
 *
 * `tailOnly` міняє питання з «де людина довго стояла» на «чи стоїть
 * вона ЗАРАЗ». Різниця принципова для автозакриття: воно дивиться на
 * зміну ввечері, коли людина ще може їхати, і без цього прапорця
 * закрило б її обідом — найдовшою зупинкою дня, що давно позаду.
 * Людині в застосунку, навпаки, потрібна саме здогадка про кінець
 * роботи, тому там прапорець не ставиться.
 */
export async function guessWorkEnd(
  shiftId: string,
  opts: { tailOnly?: boolean } = {}
): Promise<StopGuess | null> {
  const points = await prisma.trackPoint.findMany({
    where: { shiftId },
    orderBy: { recordedAt: "asc" },
    select: { lat: true, lng: true, recordedAt: true },
  });

  if (points.length < 3) return null;

  let best: StopGuess | null = null;
  let anchorIdx = 0;

  for (let i = 1; i < points.length; i++) {
    // У режимі хвоста проміжні зупинки не цікавлять — потрібен лише
    // якір останнього відрізка, тому здогадку тут не запам'ятовуємо.
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
      if (!opts.tailOnly && stoodMin >= STOP_MINUTES) {
        best = {
          at: points[anchorIdx].recordedAt,
          minutes: Math.round(stoodMin),
          lat: points[anchorIdx].lat,
          lng: points[anchorIdx].lng,
          gapBeforeMin: gapBefore(points, anchorIdx),
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
      gapBeforeMin: gapBefore(points, anchorIdx),
    };
  }

  return best;
}

/**
 * Скільки трек мовчав перед точкою з індексом `idx`.
 *
 * Дивимося саме на сусідню пару, а не на найбільший розрив за день:
 * діра о десятій ранку нічого не каже про вечірню зупинку, якщо після
 * неї трек чесно показав і рух, і зупинку. Значення має лише те, чи
 * бачили ми, як машина ставала.
 */
function gapBefore(points: Array<{ recordedAt: Date }>, idx: number): number {
  if (idx <= 0) return 0;
  return Math.round(
    (points[idx].recordedAt.getTime() - points[idx - 1].recordedAt.getTime()) / 60_000
  );
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
