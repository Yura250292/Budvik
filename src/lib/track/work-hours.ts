/**
 * Робочі години: межа показу, а не межа запису.
 *
 * Різниця принципова. Бот відкидав точки поза вікном ДО запису в базу —
 * і виїзд о 5:40 просто зникав, разом із доказом, що людина працювала.
 * Тут навпаки: пристрій пише цілодобово, а фільтр стоїть на показі.
 * Дані лишаються цілі — якщо колись доведеться розбирати вечірню
 * пригоду, точки на місці; просто щодня їх ніхто не бачить.
 *
 * Заразом це прибирає з карти ніч у дворі торгового: пристрій лежить
 * удома й повільно дрейфує GPS-ом, малюючи «поїздки», яких не було.
 */

import { KYIV_TZ } from "@/lib/date/kyiv";

/**
 * Ті самі межі, що були в боті (TRACK_WORK_HOUR_FROM/TO), щоб цифри
 * двох систем можна було класти поруч і порівнювати.
 */
export const WORK_HOUR_FROM = 6;
export const WORK_HOUR_TO = 21;

/** Київська година доби для мітки часу. */
export function kyivHour(at: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: KYIV_TZ,
      hour: "2-digit",
      hour12: false,
    }).format(at)
  );
}

/** Чи потрапляє мить у робоче вікно (за київським часом). */
export function isWorkingTime(at: Date): boolean {
  const h = kyivHour(at);
  return h >= WORK_HOUR_FROM && h < WORK_HOUR_TO;
}

/**
 * Лишає тільки робочі точки.
 *
 * Дженерик, бо ту саму функцію викликають і для TrackPoint з планшета,
 * і для SalesTrackPoint з бота — спільне в них лише recordedAt.
 */
export function onlyWorkingHours<T extends { recordedAt: Date }>(points: T[]): T[] {
  return points.filter((p) => isWorkingTime(p.recordedAt));
}

/** Людський підпис вікна для інтерфейсу: «6:00–21:00». */
export const WORK_HOURS_LABEL = `${WORK_HOUR_FROM}:00–${WORK_HOUR_TO}:00`;
