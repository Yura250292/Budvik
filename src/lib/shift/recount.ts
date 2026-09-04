/**
 * Перерахунок треку в уже закритих змінах.
 *
 * Навіщо це взагалі потрібно: `Shift.gpsDistanceKm` рахується ОДИН раз — у
 * мить закриття — і далі лежить числом. А точки після цього ще змінюються:
 * хвіст буфера доїжджає годинами, прибирання викидає неможливі фікси,
 * домальовка розривів дописує дорогу. 03.09 Ігор закрив зміну з перуанськими
 * точками в базі, і в картці лишилося 23 817 км навіть тоді, коли карта вже
 * показувала справжні 95.
 *
 * Мітка `trackKmAt` робить це дешевим: перераховуємо лише ті зміни, у яких
 * після неї з'явилися нові точки.
 */

import { prisma } from "@/lib/prisma";
import { computeShiftTrackFields } from "@/lib/shift/service";

export type RecountResult = {
  id: string;
  name: string | null;
  startedAt: Date;
  /** Одометр — для порівняння, сам він не змінюється */
  distanceKm: number | null;
  before: number | null;
  after: number | null;
  stopKm: number | null;
  walkKm: number | null;
  changed: boolean;
};

/** Перераховує одну зміну. Пише лише при `apply`. */
export async function recountShiftTrack(
  shift: {
    id: string;
    startedAt: Date;
    endedAt: Date | null;
    gpsDistanceKm: number | null;
    distanceKm: number | null;
    user?: { name: string | null } | null;
  },
  opts: { apply?: boolean } = {}
): Promise<RecountResult> {
  const track = await computeShiftTrackFields(shift);

  /**
   * Співвідношення перераховуємо разом із пробігом: інакше в картці
   * лишиться стара оцінка «одометр / трек», порахована від іншого числа.
   */
  const ratio =
    shift.distanceKm != null && track.driveKm != null && track.driveKm > 0
      ? Math.round((shift.distanceKm / track.driveKm) * 100) / 100
      : null;

  const changed = track.driveKm !== shift.gpsDistanceKm;

  if (opts.apply) {
    await prisma.shift.update({
      where: { id: shift.id },
      data: { ...track, odometerToGpsRatio: ratio },
    });
  }

  return {
    id: shift.id,
    name: shift.user?.name ?? null,
    startedAt: shift.startedAt,
    distanceKm: shift.distanceKm,
    before: shift.gpsDistanceKm,
    after: track.driveKm,
    stopKm: track.stopKm,
    walkKm: track.walkKm,
    changed,
  };
}

/**
 * Зміни, у яких число вже не відповідає точкам.
 *
 * Умова навмисно широка — `trackKmAt` порожній АБО молодші за нього точки:
 * старі зміни мітки не мають зовсім, і без першої половини умови вони
 * ніколи б не перерахувалися.
 */
export async function findStaleShifts(sinceDays: number, limit = 200) {
  const since = new Date(Date.now() - sinceDays * 864e5);
  const shifts = await prisma.shift.findMany({
    where: { startedAt: { gte: since }, status: { in: ["CLOSED", "ABANDONED"] } },
    orderBy: { startedAt: "desc" },
    take: limit,
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      gpsDistanceKm: true,
      distanceKm: true,
      trackKmAt: true,
      user: { select: { name: true } },
    },
  });

  if (shifts.length === 0) return shifts;

  /**
   * Одним запитом на всі зміни, а не запитом на кожну.
   *
   * Прохід ходить щогодини й дивиться на кілька днів; окремий `count` на
   * зміну — це сотні запитів на порожньому місці, та ще й до бази, якою
   * ходить обмін і сам сайт.
   */
  const newest = await prisma.trackPoint.groupBy({
    by: ["shiftId"],
    where: { shiftId: { in: shifts.map((s) => s.id) } },
    _max: { createdAt: true },
  });
  const lastPointAt = new Map(newest.map((r) => [r.shiftId, r._max.createdAt]));

  return shifts.filter((shift) => {
    // Мітки немає взагалі — зміна з часів до розкладу треку, рахуємо заново.
    if (shift.trackKmAt == null) return true;
    const arrived = lastPointAt.get(shift.id);
    return arrived != null && arrived > shift.trackKmAt;
  });
}

/**
 * Нічний прохід воркера: перерахувати те, що встигло змінитися.
 *
 * Три доби, а не одна: одометр забутої зміни добивається зранку наступного
 * дня, а підтвердження офісу приходить ще пізніше.
 */
export async function recountRecentShifts(sinceDays = 3): Promise<RecountResult[]> {
  const stale = await findStaleShifts(sinceDays);
  const out: RecountResult[] = [];
  for (const shift of stale) {
    out.push(await recountShiftTrack(shift, { apply: true }));
  }
  return out.filter((r) => r.changed);
}
