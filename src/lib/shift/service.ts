/**
 * Життєвий цикл зміни торгового.
 *
 * Логіка живе тут, а не в роутах: відкриття зміни вміє заразом закрити
 * забуту вчорашню, і ця пара мусить бути однією транзакцією. Розкидана
 * по двох роутах, вона рано чи пізно розійшлася б.
 */

import { prisma } from "@/lib/prisma";
import type { OdometerSource, Prisma } from "@prisma/client";
import { haversineM, MAX_ACCURACY_M } from "@/lib/track/geo";

/** Скільки годин зміна може висіти відкритою, поки її не визнають забутою. */
export const ABANDON_AFTER_HOURS = 20;

export type ShiftSummary = {
  id: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  startOdometer: number;
  endOdometer: number | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  gpsDistanceKm: number | null;
  odometerToGpsRatio: number | null;
  personalKm: number | null;
  odometerSuspicious: boolean;
  closedAutomatically: boolean;
};

/** Відкрита зміна людини або null. */
export async function findOpenShift(userId: string) {
  return prisma.shift.findFirst({
    where: { userId, status: "OPEN" },
    orderBy: { startedAt: "desc" },
  });
}

/** Остання зміна з відомим кінцевим одометром — точка відліку для наступної. */
export async function findLastFinished(userId: string) {
  return prisma.shift.findFirst({
    where: { userId, status: { in: ["CLOSED", "ABANDONED"] }, endOdometer: { not: null } },
    orderBy: { startedAt: "desc" },
    select: { id: true, endOdometer: true, endedAt: true, distanceKm: true, startedAt: true },
  });
}

/**
 * Пробіг за GPS-треком зміни.
 *
 * Завжди НИЖЧА межа: трек — ламана між точками раз на хвилину, а дорога
 * між ними довша. Тому одометр, більший за GPS, — норма; тривожить
 * зворотне співвідношення (кілометри є, а треку до них немає).
 */
export async function gpsDistanceForShift(shiftId: string): Promise<number | null> {
  const points = await prisma.trackPoint.findMany({
    where: { shiftId, phase: "SHIFT" },
    orderBy: { recordedAt: "asc" },
    select: {
      lat: true,
      lng: true,
      accuracyM: true,
      roadMetersFromPrev: true,
    },
  });
  if (points.length < 2) return null;

  /**
   * Кілометри рахуємо ЛИШЕ між точками, яким можна вірити.
   *
   * У треку тепер лежать і слабкі фікси (по вежі, з похибкою в сотні
   * метрів) — вони показують, де людина їхала, коли GPS не бачив неба, і
   * без них у дні зяяли дірки. Але в пробіг їх пускати не можна: сусідні
   * такі точки «стрибають» на пів кілометра, стоячи на місці, і зміна
   * набирала б кілометри з нічого. Тому йдемо від надійної до надійної,
   * перестрибуючи слабкі — рівно так, як рахує сам прийом пачки.
   */
  const trusted = points.filter(
    (p) => p.accuracyM == null || p.accuracyM <= MAX_ACCURACY_M
  );
  if (trusted.length < 2) return null;

  let meters = 0;
  for (let i = 1; i < trusted.length; i++) {
    // Там, де розрив добито реальною дорогою, беремо її — інакше пробіг
    // занижується рівно на офлайнові ділянки. roadMetersFromPrev міряний
    // саме від попередньої надійної точки, тож ряд не рветься.
    const road = trusted[i].roadMetersFromPrev;
    meters +=
      road != null
        ? road
        : haversineM(trusted[i - 1].lat, trusted[i - 1].lng, trusted[i].lat, trusted[i].lng);
  }
  return Math.round(meters / 100) / 10;
}

/**
 * Закриває зміну, яку торговий забув закрити.
 *
 * Пробіг береться зі СТАРТУ наступної зміни: іншого числа просто не
 * існує — кінцевого фото немає, а одометр показує значення лише на
 * знімку. Тому в цей пробіг неминуче входить і вечір, і дорога додому.
 * Позначаємо це прапорцем, щоб цифра не видавалася за чисто робочу.
 */
export async function autoCloseForgotten(
  tx: Prisma.TransactionClient,
  forgotten: {
    id: string;
    startOdometer: number;
    startedAt: Date;
    /** Чи торговий уже закрив її ввечері, вказавши час без фото */
    closedLate?: boolean;
    /** Кілометри після закінчення роботи за GPS — якщо час відомий */
    afterWorkKm?: number | null;
    endedAt?: Date | null;
  },
  nextStartOdometer: number,
  /**
   * id зміни, яка її закрила. null, коли та ще не створена: часткового
   * унікального індексу «одна OPEN на людину» вистачає, щоб забута
   * зміна мусила закритися ПЕРШОЮ, а посилання дописалося другим кроком.
   */
  nextShiftId: string | null
): Promise<{
  id: string;
  distanceKm: number | null;
  startedAt: Date;
  afterWorkKm: number | null;
}> {
  const totalKm = nextStartOdometer - forgotten.startOdometer;
  const plausible = totalKm >= 0 && totalKm <= 5000;

  /**
   * Якщо торговий увечері закрив зміну «без фото, вказавши час», ми вже
   * знаємо за GPS, скільки з цього пробігу — дорога додому й вечір.
   * Віднімаємо їх, і в distanceKm лишається саме робоче.
   *
   * Без цього кроку весь вечір ліг би в робочий пробіг — і людину
   * питали б за кілометри, яких вона не намотувала по клієнтах.
   *
   * GPS занижений (трек іде по прямій між точками), тому віднімаємо
   * обережно: якщо оцінка більша за половину пробігу, щось не так —
   * краще лишити все як є й розібратися очима.
   */
  const after = forgotten.closedLate ? (forgotten.afterWorkKm ?? 0) : 0;
  const trustAfter = after > 0 && plausible && after < totalKm / 2;
  const workKm = trustAfter ? Math.round(totalKm - after) : totalKm;

  await tx.shift.update({
    where: { id: forgotten.id },
    data: {
      status: "ABANDONED",
      closedAutomatically: true,
      autoClosedByShiftId: nextShiftId,
      endOdometer: nextStartOdometer,
      // Джерела «AI» тут немає — число прийшло з наступної зміни, а не
      // з фото цієї. MANUAL найчесніше описує походження.
      endOdometerSource: "MANUAL" as OdometerSource,
      distanceKm: plausible ? workKm : null,
      odometerSuspicious: true,
      // Час закінчення не чіпаємо, якщо торговий уже вказав його сам:
      // його «о 17:20 я був удома» точніше за «зараз».
      ...(forgotten.endedAt ? {} : { endedAt: new Date() }),
      ...(trustAfter ? { afterWorkKm: after } : {}),
    },
  });

  return {
    id: forgotten.id,
    distanceKm: plausible ? workKm : null,
    startedAt: forgotten.startedAt,
    /** Скільки вечірніх кілометрів вдалося відняти від робочих */
    afterWorkKm: trustAfter ? after : null,
  };
}

/** Підсумок зміни для екрана застосунку й адмінки. */
export function summarize(shift: {
  id: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  startOdometer: number;
  endOdometer: number | null;
  distanceKm: number | null;
  durationMinutes: number | null;
  gpsDistanceKm: number | null;
  odometerToGpsRatio: number | null;
  personalKm: number | null;
  odometerSuspicious: boolean;
  closedAutomatically: boolean;
}): ShiftSummary {
  return {
    id: shift.id,
    status: shift.status,
    startedAt: shift.startedAt,
    endedAt: shift.endedAt,
    startOdometer: shift.startOdometer,
    endOdometer: shift.endOdometer,
    distanceKm: shift.distanceKm,
    durationMinutes: shift.durationMinutes,
    gpsDistanceKm: shift.gpsDistanceKm,
    odometerToGpsRatio: shift.odometerToGpsRatio,
    personalKm: shift.personalKm,
    odometerSuspicious: shift.odometerSuspicious,
    closedAutomatically: shift.closedAutomatically,
  };
}
