/**
 * Що робити з кожним фіксом GPS.
 *
 * Проріджування тут — не економія місця, а якість лінії. Планшет у тримачі
 * віддає фікс кожні 20 секунд, і на стоянці ці точки складаються у хмару
 * навколо магазину: на карті вона читається як петляння, а в кілометражі дає
 * зайві сотні метрів «пробігу» від дрейфу приймача.
 *
 * Числа перенесені з Kotlin-служби один в один — вони обрані не з голови, а
 * після звірки з реальними днями.
 */

import type { LocationObject } from "expo-location";
import { addPoint } from "./db";
import { getLastWritten, getMode, setLastFix, setLastWritten } from "./state";
import { maybeFlush } from "./uploader";

/** Гірше за кілометр — це не координата, а здогад базової станції. */
const MAX_ACCURACY_M = 1000;
/** Поки не зрушили на стільки — пишемо не частіше, ніж раз на хвилину. */
const MOVE_M = 25;
const IDLE_WRITE_MS = 60_000;
/** Швидкість вище цієї — збій приймача, а не автомобіль. */
const MAX_SPEED_KMH = 150;
/** Курс на місці — шум компаса, а не напрямок руху. */
const HEADING_MIN_MS = 1;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function onLocations(locations: LocationObject[]): Promise<void> {
  const mode = await getMode();
  // Служба ще жива, а трек уже вимкнено — точки нікуди не пишемо.
  if (!mode) return;

  for (const loc of locations) {
    const { latitude, longitude, accuracy, speed, heading } = loc.coords;
    if (accuracy != null && accuracy > MAX_ACCURACY_M) continue;

    // Пульс бачить останній фікс навіть тоді, коли точку не записали:
    // «приймач мовчить» і «стоїмо на місці» — різні речі.
    await setLastFix(loc.timestamp, accuracy != null ? Math.round(accuracy) : null);

    const last = await getLastWritten();
    const movedM = last ? haversineM(last.lat, last.lng, latitude, longitude) : Infinity;
    const waitedMs = last ? loc.timestamp - last.at : Infinity;
    if (movedM < MOVE_M && waitedMs < IDLE_WRITE_MS) continue;

    const speedKmh =
      speed != null && speed >= 0 ? Math.min(Math.round(speed * 3.6), MAX_SPEED_KMH) : null;

    await addPoint({
      // Час пристрою з самого фікса, а не Date.now(): пачка може лежати в
      // буфері годинами, і час відправки перетворив би стоянку на телепорт.
      recordedAt: new Date(loc.timestamp).toISOString(),
      lat: latitude,
      lng: longitude,
      accuracyM: accuracy != null ? Math.round(accuracy) : null,
      speedKmh,
      headingDeg:
        heading != null && heading >= 0 && speed != null && speed > HEADING_MIN_MS
          ? Math.round(heading)
          : null,
      phase: mode === "AFTER_SHIFT" ? "AFTER_SHIFT" : null,
    });
    await setLastWritten(loc.timestamp, latitude, longitude);
  }

  await maybeFlush();
}
