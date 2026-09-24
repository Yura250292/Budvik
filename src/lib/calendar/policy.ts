/**
 * Правила конектора, які захочеться міняти, не читаючи рушій.
 *
 * Модуль без next/* — його збирає воркер.
 */

import { kyivDate, kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";

/**
 * Скільки днів звіряємо.
 *
 * Календар — про найближче майбутнє: минуле нікого не цікавить і вже не
 * змінюється, а рік уперед нічого не вартий, бо плани доти перепишуться.
 * Учорашній день лишаємо, щоб прострочена задача не зникала з очей саме
 * тоді, коли про неї треба пам'ятати.
 */
export const WINDOW_BACK_DAYS = 1;
export const WINDOW_AHEAD_DAYS = 14;

/**
 * Скільки викликів Google робимо одній людині за тік.
 *
 * Перше підключення (порожній календар, який треба наповнити цілком)
 * розкладається на кілька тіків замість сплеску запитів.
 */
export const CALLS_PER_TICK = 25;

/** Замок протухає — інакше воркер, убитий посеред запису, тримав би рядок вічно. */
export const STALE_LOCK_MS = 10 * 60_000;

/** Беклоф: хвилина, п'ять, чверть години, далі година. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export type SyncWindow = {
  /** Київська доба YYYY-MM-DD. */
  from: string;
  to: string;
  /** Ті самі межі як миті — для запитів до бази. */
  start: Date;
  end: Date;
};

export function windowFor(now: Date): SyncWindow {
  const from = kyivDate(new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000));
  const to = kyivDate(new Date(now.getTime() + WINDOW_AHEAD_DAYS * 86_400_000));
  return { from, to, start: kyivDayStart(from), end: kyivDayEnd(to) };
}

/** Коли пробувати знову після невдачі. */
export function nextAttempt(now: Date, attempts: number): Date {
  return new Date(now.getTime() + (BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)] ?? 60_000));
}
