/**
 * Що робити з кожним фіксом GPS.
 *
 * Проріджування тут — не економія місця, а якість лінії. Планшет у тримачі
 * віддає фікс кожні 20 секунд, і на стоянці ці точки складаються у хмару
 * навколо магазину: на карті вона читається як петляння, а в кілометражі дає
 * зайві сотні метрів «пробігу» від дрейфу приймача.
 *
 * Самі правила відсіву — у fix-gate.ts: там їх можна прогнати на справжніх
 * треках з бази, а тут лишається лише запис того, що пройшло.
 */

import type { LocationObject } from "expo-location";
import { addPoint } from "./db";
import { contextGate, type RecordedFix } from "./fix-gate";
import { countFixBatch, getLastWritten, getMode, setLastFix, setLastWritten } from "./state";
import { heartbeat, maybeFlush } from "./uploader";

/** Швидкість вище цієї — збій приймача, а не автомобіль. */
const MAX_SPEED_KMH = 150;
/** Курс на місці — шум компаса, а не напрямок руху. */
const HEADING_MIN_MS = 1;

export async function onLocations(locations: LocationObject[]): Promise<void> {
  let written = 0;
  const mode = await getMode();
  // Служба ще жива, а трек уже вимкнено — точки нікуди не пишемо.
  if (!mode) return;

  for (const loc of locations) {
    const { latitude, longitude, accuracy, speed, heading } = loc.coords;

    /**
     * Мітку фікса ставимо ПЕРШОЮ — раніше за будь-який відсів.
     *
     * Це не дрібниця порядку рядків, це два дні розборів. Досі фікси гірші за
     * кілометр відкидалися ДО цього рядка, і пульс через те казав «приймач
     * мовчав 118 хв» на планшеті, який спокійно стояв у приміщенні й отримував
     * позицію по вежі. Ми шукали поламку служби, дозволів і батареї — а
     * приймач просто не бачив неба, і сказати цього було нікому.
     *
     * Тепер у пульс іде і час, і похибка будь-якого фікса. «Приймач мовчить» і
     * «приймач дає ±1200 м» — різні стани, і на карті це різні висновки:
     * перший означає поламку, другий — що людина в будівлі.
     */
    await setLastFix(loc.timestamp, accuracy != null ? Math.round(accuracy) : null);

    const fix: RecordedFix = {
      at: loc.timestamp,
      lat: latitude,
      lng: longitude,
      accuracyM: accuracy ?? null,
      kmh: speed != null && speed >= 0 ? speed * 3.6 : null,
      heading: heading ?? null,
      speed: speed ?? null,
    };

    /**
     * Заслінка може віддати два фікси: притриманий, який виявився рухом, і
     * поточний. «Останню записану» оновлюємо після КОЖНОГО — від неї рахується
     * наступне рішення.
     */
    const toWrite = contextGate.decide(fix, await getLastWritten());
    for (const w of toWrite) {
      written++;
      await addPoint({
        // Час пристрою з самого фікса, а не Date.now(): пачка може лежати в
        // буфері годинами, і час відправки перетворив би стоянку на телепорт.
        recordedAt: new Date(w.at).toISOString(),
        lat: w.lat,
        lng: w.lng,
        accuracyM: w.accuracyM != null ? Math.round(w.accuracyM) : null,
        speedKmh: w.kmh != null ? Math.min(Math.round(w.kmh), MAX_SPEED_KMH) : null,
        headingDeg:
          w.heading != null && w.heading >= 0 && w.speed != null && w.speed > HEADING_MIN_MS
            ? Math.round(w.heading)
            : null,
        phase: mode === "AFTER_SHIFT" ? "AFTER_SHIFT" : null,
      });
      await setLastWritten(w.at, w.lat, w.lng);
    }
  }

  /**
   * Лічильник пачок за життя контексту.
   *
   * Разом із часом підйому контексту це відповідь на головне питання розбору:
   * служба взагалі викликає нас чи ні. Прапорець `tracking` на нього не
   * відповідає — він однаковий і в живої служби, і в мертвої.
   */
  countFixBatch(written);

  await maybeFlush();

  /**
   * Пульс — звідси, а не лише зі сторожа.
   *
   * Досі пульс слали тільки сторож (раз на чверть години) і холодний старт.
   * На планшетах Lenovo TB350XU сторож майже не прокидається: 04.09 Передрій
   * написав 1845 точок і рівно 2 пульси, і карта весь день казала
   * «застосунок мовчить» про планшет, який працював бездоганно.
   *
   * Тепер пульс іде звідти, де точно видно життя, — з обробки фіксів. Своя
   * межа в три хвилини вже стоїть усередині heartbeat(), тож частота від
   * цього не зростає.
   */
  await heartbeat().catch(() => {});
}
