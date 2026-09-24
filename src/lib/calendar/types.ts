/**
 * Спільні типи конектора календаря.
 *
 * Модуль без next/* — його збирає воркер (див. CLAUDE.md).
 */

/** Мітка «конектор живий» у SyncState — як meetings:lastTick у нарад. */
export const CALENDAR_TICK_KEY = "calendar:lastTick";

/** Що саме сайт кладе в календар. Рядок їде в CalendarEventLink.entity. */
export type CalendarEntity =
  | "STAFF_TASK"
  | "DELIVERY_ROUTE"
  | "ASSISTANT_REMINDER"
  | "REP_ROUTE_DAY";

/**
 * Подія, якою вона МАЄ бути в календарі.
 *
 * Проєктор кожної сутності повертає такі записи, далі рушій сам вирішує,
 * що вставити, що виправити, а що прибрати. Знання про предметну область
 * закінчується тут: нижче по течії ніхто не знає, що таке задача чи маршрут.
 *
 * `day` і `at` виключають одне одного: подія або на всю добу, або з часом.
 */
export type DesiredEvent = {
  entity: CalendarEntity;
  entityId: string;
  summary: string;
  description: string | null;
  location: string | null;
  /** Київська доба YYYY-MM-DD — подія на весь день. */
  day: string | null;
  /** Момент початку — подія з часом. */
  at: Date | null;
  /** Скільки хвилин триває подія з часом. */
  minutes: number | null;
};
