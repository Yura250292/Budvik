/**
 * Геометрія веб-треку: відстані між точками і відсів сміття.
 *
 * Живе окремо від API, бо ті самі правила потрібні і при прийомі пачки, і
 * при перерахунку дня, і в тестах. Логіка навмисно арифметична, без
 * Prisma — так її можна прогнати на масиві з фікстури.
 */

/** Точка треку в тому вигляді, в якому її шле планшет. */
export type RawPoint = {
  lat: number;
  lng: number;
  accuracyM?: number | null;
  speedKmh?: number | null;
  headingDeg?: number | null;
  /** ISO-рядок часу GPS-події на пристрої */
  recordedAt: string;
};

/**
 * Похибка, за якою точка вже нічого не доводить.
 *
 * 100 м — це половина кварталу: «був біля клієнта» з такою точністю
 * не перевіряється, зате така точка легко додає до пробігу кілометри,
 * яких не було. Дешевше відкинути.
 */
export const MAX_ACCURACY_M = 100;

/**
 * Швидкість, вище якої стрибок вважається помилкою GPS, а не поїздкою.
 *
 * 150 км/год: бус з товаром так не їде, а от «стрибок» на кілька
 * кілометрів у момент, коли планшет перечепився з вежі на вежу — типова
 * картина. Такі точки зберігаємо (вони частина сирих даних), але в
 * пробіг не рахуємо.
 */
export const MAX_PLAUSIBLE_KMH = 150;

/** Мінімальний зсув, який вважаємо рухом, а не дрейфом GPS на стоянці. */
export const MIN_MOVE_M = 15;

/**
 * Відстань, з якої відрізок уже не можна вважати прямою дорогою.
 *
 * Трек — ламана між точками GPS. Поки точки йдуть кожні 15 секунд, відрізки
 * короткі й пряма між ними майже збігається з дорогою. Але коли планшет був
 * офлайн (у тримачі без інтернету, з вимкненим екраном), у треку виникає
 * розрив — і дві точки з різних кінців міста з'єднуються прямою через дахи.
 * Пробіг тоді занижений: реальна дорога довша за хорду.
 *
 * 800 м — межа, за якою різниця стає відчутною. Коротші розриви лишаємо як
 * є: ганяти OSRM заради 200 метрів дорожче, ніж похибка, яку це виправить.
 */
export const GAP_M = 800;

const EARTH_R = 6_371_000;

/** Відстань по прямій між двома точками, метри. */
export function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type PreparedPoint = {
  lat: number;
  lng: number;
  accuracyM: number | null;
  speedKmh: number | null;
  headingDeg: number | null;
  recordedAt: Date;
  metersFromPrev: number | null;
  minutesFromPrev: number | null;
  /** Чи додавати відстань до пробігу: false для стрибків і дрейфу на місці */
  countsToDistance: boolean;
  /**
   * Розрив у треку: попередня точка далеко, і пряма між ними — не дорога.
   * Такі відрізки добиваємо реальним маршрутом OSRM, див. resolveGaps.
   */
  isGap: boolean;
};

export type PrepareResult = {
  points: PreparedPoint[];
  /** Скільки відкинуто і чому — планшет показує це в індикаторі */
  rejected: { accuracy: number; stale: number; malformed: number };
  /** Приріст пробігу за цю пачку, км */
  addedKm: number;
  /** Час останньої прийнятої точки */
  lastAt: Date | null;
};

/**
 * Готує пачку точок від планшета до вставки.
 *
 * Приймає стан попередньої точки (з БД), бо пачка приходить у продовження
 * дня, а не з нуля: без цього перша точка кожної пачки не мала б
 * metersFromPrev і пробіг занижувався б на кожному флаші.
 */
export function preparePoints(
  raw: RawPoint[],
  prev: { lat: number; lng: number; recordedAt: Date } | null
): PrepareResult {
  const rejected = { accuracy: 0, stale: 0, malformed: 0 };
  const points: PreparedPoint[] = [];
  let addedM = 0;

  // Планшет може віддати пачку не по порядку (буфер після офлайну
  // склеюється з двох частин) — сортуємо, інакше metersFromPrev рахувався
  // б від майбутнього.
  const sorted = [...raw].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );

  let cursor = prev;

  for (const p of sorted) {
    const at = new Date(p.recordedAt);
    if (
      !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lng) ||
      Math.abs(p.lat) > 90 ||
      Math.abs(p.lng) > 180 ||
      Number.isNaN(at.getTime())
    ) {
      rejected.malformed++;
      continue;
    }

    // Точка не новіша за вже записану — повторна відправка пачки після
    // таймауту. Ідемпотентність без унікального ключа на координатах.
    if (cursor && at.getTime() <= cursor.recordedAt.getTime()) {
      rejected.stale++;
      continue;
    }

    // Та сама координата з новішим часом — теж повтор: планшет
    // перевідправив буфер, перештампувавши мітки (так робить ретрай, який
    // бере час відправки замість часу події). Без цієї перевірки дубль
    // проходить, бо формально він «новіший».
    if (
      cursor &&
      Math.abs(cursor.lat - p.lat) < 1e-7 &&
      Math.abs(cursor.lng - p.lng) < 1e-7
    ) {
      rejected.stale++;
      continue;
    }

    if (typeof p.accuracyM === "number" && p.accuracyM > MAX_ACCURACY_M) {
      rejected.accuracy++;
      continue;
    }

    let metersFromPrev: number | null = null;
    let minutesFromPrev: number | null = null;
    let countsToDistance = false;
    let isGap = false;

    if (cursor) {
      const meters = haversineM(cursor.lat, cursor.lng, p.lat, p.lng);
      const minutes = (at.getTime() - cursor.recordedAt.getTime()) / 60_000;
      metersFromPrev = Math.round(meters);
      minutesFromPrev = Math.round(minutes);

      const kmh = minutes > 0 ? meters / 1000 / (minutes / 60) : Infinity;
      countsToDistance = meters >= MIN_MOVE_M && kmh <= MAX_PLAUSIBLE_KMH;
      // Довгий відрізок — планшет був офлайн. Хорда занижує пробіг, тож
      // позначаємо: справжню довжину дорогою добере resolveGaps.
      isGap = countsToDistance && meters >= GAP_M;
      if (countsToDistance) addedM += meters;
    }

    points.push({
      lat: p.lat,
      lng: p.lng,
      accuracyM: typeof p.accuracyM === "number" ? Math.round(p.accuracyM) : null,
      speedKmh: typeof p.speedKmh === "number" ? Math.round(p.speedKmh) : null,
      headingDeg:
        typeof p.headingDeg === "number" ? Math.round(p.headingDeg) : null,
      recordedAt: at,
      metersFromPrev,
      minutesFromPrev,
      countsToDistance,
      isGap,
    });

    cursor = { lat: p.lat, lng: p.lng, recordedAt: at };
  }

  return {
    points,
    rejected,
    addedKm: addedM / 1000,
    lastAt: points.length ? points[points.length - 1].recordedAt : null,
  };
}
