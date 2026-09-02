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

/**
 * Похибка, після якої фікс уже не координата, а коло на карті.
 *
 * Те саме число, що на сервері (`MAX_ACCURACY_M` у lib/track/geo.ts): там воно
 * ділить точки на ті, що йдуть у пробіг, і ті, що лише малюються. Тут — межа,
 * за якою фікс може взагалі не мати сенсу (див. STANDING_KMH).
 */
const WEAK_ACCURACY_M = 100;

/**
 * Швидкість, нижче якої вважаємо, що людина стоїть.
 *
 * Не нуль: приймач майже ніколи не пише рівний нуль, а пішохідні 1–2 км/год
 * усередині двору — це та сама стоянка.
 */
const STANDING_KMH = 3;
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

    // Гірше за кілометр у трек не пишемо: це не координата, а здогад вежі.
    if (accuracy != null && accuracy > MAX_ACCURACY_M) continue;

    /**
     * Слабкий фікс на місці не додає НІЧОГО — і саме він малює віяла.
     *
     * Android віддає позицію з трьох джерел: супутники (3–15 м), Wi-Fi
     * (20–50 м) і базові станції (сотні метрів). Коли неба не видно — людина
     * зайшла до клієнта, стала під дахом, у дворі між будинками — супутники
     * зникають, і система чесно віддає позицію по вежі з похибкою ±400–700 м.
     * Поки вона там стоїть, телефон перестрибує між вежами, і кожен стрибок
     * лягає на карту як поїздка на кілометр туди й назад.
     *
     * Дані 02.09 показують це без здогадів: у Олександра 249 фіксів кращі за
     * 10 м із середньою швидкістю 17 км/год, а всі 120 фіксів гірші за 150 м —
     * рівно на нульовій швидкості. Що гірша похибка, то нижча швидкість.
     *
     * Такий фікс не каже нічого нового: людина стоїть, і де вона — вже відомо
     * з попереднього доброго фікса. Тому відкидаємо. У РУСІ похибка 3–10 м,
     * тож дорога від цього правила не страждає — на відміну від фільтрів за
     * формою лінії, які різали справжню заміську трасу.
     *
     * Пульс при цьому вже отримав `setLastFix` вище: «приймач мовчить» і «стою
     * в приміщенні» лишаються різними станами, і хибної тривоги не буде.
     */
    const kmh = speed != null && speed >= 0 ? speed * 3.6 : null;
    if (accuracy != null && accuracy > WEAK_ACCURACY_M && (kmh === null || kmh < STANDING_KMH)) {
      continue;
    }

    const last = await getLastWritten();
    const movedM = last ? haversineM(last.lat, last.lng, latitude, longitude) : Infinity;
    const waitedMs = last ? loc.timestamp - last.at : Infinity;
    if (movedM < MOVE_M && waitedMs < IDLE_WRITE_MS) continue;

    const speedKmh = kmh != null ? Math.min(Math.round(kmh), MAX_SPEED_KMH) : null;

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
