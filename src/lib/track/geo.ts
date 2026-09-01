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
 * Похибка, за якою точці вже не можна вірити в КІЛОМЕТРАХ.
 *
 * 100 м — це половина кварталу: «був біля клієнта» з такою точністю не
 * перевіряється, і в пробіг така точка додала б кілометри, яких не було.
 *
 * Але «не вірити» — не те саме, що «викинути». Раніше такі точки
 * відсіювались, і це коштувало нам треку: коли машина виїжджає з міста,
 * фікс деградує (77 → 92 → 98 м), точки перестають проходити поріг — і в
 * дні з'являється дірка на 26 хвилин, через яку карта малює пряму на
 * 31 км. За 26.08 так втрачалось 55–65% кілометрів дня у КОЖНОГО
 * торгового, і в базі не лишалось навіть сліду, що точки були.
 *
 * Тому тепер поріг вирішує лише одне: чи рахувати цю точку в пробіг.
 * Сама точка лягає в трек — гірше знати приблизно, ніж не знати нічого.
 */
export const MAX_ACCURACY_M = 100;

/**
 * Похибка, за якою це вже не місце, а назва населеного пункту.
 *
 * Фікс по вежі за містом дає 300–800 м — на карті це та сама дорога, і
 * такий слід кращий за пряму через поля. А от кілометрові «кола» вже
 * стрибали б по екрану самі собою, нічого не показуючи.
 */
export const MAX_STORED_ACCURACY_M = 1000;

/**
 * Наскільки близько за часом мають стояти дві однакові координати, щоб
 * вважати їх повтором відправки, а не «стою на місці».
 *
 * Планшет шле фікс не частіше ніж раз на 30 секунд, тож усе, що ближче,
 * — це ретрай. А от однакова координата через хвилину — чесний факт:
 * торговий стоїть у клієнта, і саме це в треку й має бути видно.
 */
const DUPLICATE_WINDOW_MS = 30_000;

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

/**
 * Скільки слабких фіксів віддаємо OSRM як проміжні точки розриву.
 *
 * Відрізок між надійними опорами буває заповнений фіксами по вежі: шлях
 * ними засвідчений, але з похибкою в сотні метрів. Прокласти дорогу
 * просто «від опори до опори» означало б випрямити її по найкоротшому
 * маршруту — а торговий міг заїхати до клієнта вбік і повернутися.
 *
 * Тому кілька слабких точок ідуть у запит проміжними: OSRM притягує їх
 * до найближчих доріг і веде маршрут ЧЕРЕЗ них. Три — компроміс:
 * достатньо, щоб упіймати гак, і мало, щоб похибка кожної не заплутала
 * маршрут між паралельними вулицями.
 */
export const MAX_GAP_VIA = 3;

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
  /**
   * Чи точна ця точка настільки, щоб на неї спиратися в кілометрах і
   * у відповіді «був біля клієнта». Неточні теж зберігаємо — але як
   * свідчення напрямку, а не як вимір.
   */
  trusted: boolean;
  /** Чи додавати відстань до пробігу: false для стрибків і дрейфу на місці */
  countsToDistance: boolean;
  /**
   * Розрив у треку: попередня точка далеко, і пряма між ними — не дорога.
   * Такі відрізки добиваємо реальним маршрутом OSRM, див. resolveGaps.
   */
  isGap: boolean;
  /**
   * Від якої точки міряти цей розрив. Не завжди попередня в масиві:
   * між надійними кінцями могли лягти слабкі фікси, і дорогу треба
   * прокладати саме між кінцями, інакше поправка до пробігу порахується
   * на іншому відрізку, ніж позначено.
   */
  gapFrom: { lat: number; lng: number } | null;
  /**
   * Слабкі фікси, що лягли всередині розриву — щоб дорога пройшла через
   * них, а не в обхід. Порожній масив означає, що пристрій справді мовчав.
   */
  gapVia: Array<{ lat: number; lng: number }>;
};

export type PrepareResult = {
  points: PreparedPoint[];
  /** Скільки відкинуто і чому — планшет показує це в індикаторі */
  rejected: { accuracy: number; stale: number; malformed: number };
  /** Скільки збережено «на віру»: у трек лягли, у пробіг не пішли */
  untrusted: number;
  /** Приріст пробігу за цю пачку, км */
  addedKm: number;
  /** Час останньої прийнятої точки */
  lastAt: Date | null;
};

/**
 * Відстань від точки до прямої між опорами розриву, метри.
 *
 * Плоска апроксимація, як у sales/deviation: на довжині розриву кривина
 * Землі дає менше метра, а тягти сюди залежність заради цього не варто.
 */
function offChordM(
  p: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((p.lat * Math.PI) / 180);

  const px = (p.lng - a.lng) * mPerDegLng;
  const py = (p.lat - a.lat) * mPerDegLat;
  const bx = (b.lng - a.lng) * mPerDegLng;
  const by = (b.lat - a.lat) * mPerDegLat;

  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return Math.hypot(px, py);

  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  return Math.hypot(px - t * bx, py - t * by);
}

/**
 * Кілька точок із проміжку — рівномірно, а не поспіль.
 *
 * Беремо не перші три, а розкидані по всій довжині: три сусідні фікси на
 * початку відрізка не сказали б про дорогу нічого, чого не видно з самої
 * опори.
 *
 * Але спершу відсіюємо ті, що не кажуть нічого взагалі. Проміжні точки
 * тут за побудовою слабкі — довірена одразу стає новою опорою, — і
 * похибка в них буває 300-800 м. OSRM ЗОБОВ'ЯЗАНИЙ пройти крізь кожну
 * задану точку: фікс по вежі, що впав за квартал від траси, змушує
 * маршрут з'їхати в село, обігнути квартал і повернутися. Саме так у
 * Щирці на карті виникали петлі там, де торговий їхав головною, і саме
 * звідти бралися зайві кілометри: 31.08 у Валентина розриви з прямою
 * 22 км «дорогою» дали 334 км.
 *
 * Правило: точка йде в маршрут, лише якщо її відхилення від прямої між
 * опорами БІЛЬШЕ за її власну похибку. Тоді гак до клієнта — заради
 * якого via і вводилися — лишається (він на кілометри вбік, а похибка
 * сотні метрів), а тремтіння по вежах поруч із трасою відпадає: воно
 * пояснюється самою похибкою й нового про дорогу не каже.
 */
function pickVia(
  between: Array<{ lat: number; lng: number; accuracyM?: number | null }>,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): Array<{ lat: number; lng: number }> {
  const meaningful = between.filter((p) => {
    // Похибка невідома — точці віримо як є: так поводився код до цього
    // правила, і перерахунок старого дня має лишитися повторюваним.
    if (p.accuracyM == null) return true;
    return offChordM(p, from, to) > p.accuracyM;
  });

  if (meaningful.length <= MAX_GAP_VIA) {
    return meaningful.map((p) => ({ lat: p.lat, lng: p.lng }));
  }
  const step = (meaningful.length - 1) / (MAX_GAP_VIA + 1);
  const out: Array<{ lat: number; lng: number }> = [];
  for (let i = 1; i <= MAX_GAP_VIA; i++) {
    const p = meaningful[Math.round(step * i)];
    out.push({ lat: p.lat, lng: p.lng });
  }
  return out;
}

/**
 * Готує пачку точок від планшета до вставки.
 *
 * Приймає стан попередньої точки (з БД), бо пачка приходить у продовження
 * дня, а не з нуля: без цього перша точка кожної пачки не мала б
 * metersFromPrev і пробіг занижувався б на кожному флаші.
 *
 * Опор дві, і в цьому вся суть. `prev` — остання записана точка БУДЬ-ЯКОЇ
 * якості: від неї рахуються metersFromPrev і ловляться повтори.
 * `prevTrusted` — остання точка, якій можна вірити: від неї росте пробіг.
 * Без другої опори слабкі фікси або лізли б у кілометри своїм тремтінням,
 * або (як було досі) викидалися разом із ділянкою дороги, яку вони єдині
 * й засвідчували.
 */
export function preparePoints(
  raw: RawPoint[],
  prev: { lat: number; lng: number; recordedAt: Date } | null,
  /**
   * За замовчуванням — та сама точка: виклик, який про якість нічого не
   * знає (тести, перерахунок дня), поводиться рівно як раніше.
   */
  prevTrusted: { lat: number; lng: number; recordedAt: Date } | null = prev,
  /**
   * Слабкі фікси, які вже лежать у базі після останньої надійної опори.
   *
   * Відрізок між опорами майже завжди довший за одну пачку: планшет шле
   * буфер раз на дві хвилини, а поганий фікс тримається десятками
   * хвилин. Без цього списку дорога прокладалася б лише через ту
   * дрібку проміжку, що втрапила в останню пачку.
   */
  prevSinceAnchor: Array<{ lat: number; lng: number; accuracyM?: number | null }> = []
): PrepareResult {
  const rejected = { accuracy: 0, stale: 0, malformed: 0 };
  const points: PreparedPoint[] = [];
  let untrusted = 0;
  let addedM = 0;

  // Планшет може віддати пачку не по порядку (буфер після офлайну
  // склеюється з двох частин) — сортуємо, інакше metersFromPrev рахувався
  // б від майбутнього.
  const sorted = [...raw].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );

  /** Остання записана точка — будь-якої якості. */
  let cursor = prev;
  /** Остання точка, від якої чесно міряти кілометри. */
  let anchor = prevTrusted;
  /**
   * Слабкі фікси, що лягли після останньої надійної опори.
   *
   * Спершу вони лише вимикали добір дороги: мовляв, шлях уже засвідчено,
   * нехай лишається хордою. На даних 27.08 стало видно, чого це коштує.
   * У планшета з поганим приймачем 305 точок із 387 — слабкі, і саме на
   * них припадає 79 із 85 кілометрів дня. Усі вони йшли прямими: пробіг
   * занижений, а на карті замість вулиць — павутина через квартали.
   *
   * Тепер такий відрізок теж добирається дорогою, а ці точки йдуть у
   * запит проміжними — щоб дорога пройшла там, де людина справді їхала.
   */
  let sinceAnchor: Array<{ lat: number; lng: number; accuracyM?: number | null }> = [
    ...prevSinceAnchor,
  ];

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

    /**
     * Та сама координата за пів хвилини — повтор: планшет перевідправив
     * буфер, перештампувавши мітки, і формально точка «новіша».
     *
     * Вікно тут принципове. Без нього це правило викидало будь-яку
     * повторну координату — а планшет, що годину стоїть у клієнта,
     * чесно шле той самий фікс щохвилини. Виходило, що найкраще
     * задокументована частина дня («був отут із 10:31 до 11:40»)
     * зникала повністю: у Валентина за 26.08 у базі лишилась рівно
     * ОДНА точка за всю зміну.
     */
    if (
      cursor &&
      at.getTime() - cursor.recordedAt.getTime() <= DUPLICATE_WINDOW_MS &&
      Math.abs(cursor.lat - p.lat) < 1e-7 &&
      Math.abs(cursor.lng - p.lng) < 1e-7
    ) {
      rejected.stale++;
      continue;
    }

    const accuracyM = typeof p.accuracyM === "number" ? Math.round(p.accuracyM) : null;

    // Кілометр похибки — це вже не місце, а здогад по вежі.
    if (accuracyM != null && accuracyM > MAX_STORED_ACCURACY_M) {
      rejected.accuracy++;
      continue;
    }

    const trusted = accuracyM == null || accuracyM <= MAX_ACCURACY_M;
    if (!trusted) untrusted++;

    let metersFromPrev: number | null = null;
    let minutesFromPrev: number | null = null;

    if (cursor) {
      metersFromPrev = Math.round(haversineM(cursor.lat, cursor.lng, p.lat, p.lng));
      minutesFromPrev = Math.round((at.getTime() - cursor.recordedAt.getTime()) / 60_000);
    }

    /**
     * Пробіг міряємо від надійної опори, перестрибуючи слабкі точки.
     *
     * Ділянка «добра точка → три фікси по вежі → добра точка» дає рівно
     * одну відстань — між добрими кінцями. Слабкі точки лишаються на
     * карті як слід дороги, але жодного кілометра від себе не додають.
     */
    let countsToDistance = false;
    let isGap = false;
    let gapFrom: { lat: number; lng: number } | null = null;
    let gapVia: Array<{ lat: number; lng: number }> = [];

    if (trusted && anchor) {
      const meters = haversineM(anchor.lat, anchor.lng, p.lat, p.lng);
      const minutes = (at.getTime() - anchor.recordedAt.getTime()) / 60_000;
      const kmh = minutes > 0 ? meters / 1000 / (minutes / 60) : Infinity;

      countsToDistance = meters >= MIN_MOVE_M && kmh <= MAX_PLAUSIBLE_KMH;
      // Довгий відрізок між опорами — завжди привід прокласти дорогу,
      // мовчав пристрій чи слав слабкі фікси. Різниця лише в тому, чи
      // є через що вести маршрут (див. gapVia).
      isGap = countsToDistance && meters >= GAP_M;
      if (isGap) {
        gapFrom = { lat: anchor.lat, lng: anchor.lng };
        gapVia = pickVia(sinceAnchor, anchor, p);
      }
      if (countsToDistance) addedM += meters;
    }

    points.push({
      lat: p.lat,
      lng: p.lng,
      accuracyM,
      speedKmh: typeof p.speedKmh === "number" ? Math.round(p.speedKmh) : null,
      headingDeg:
        typeof p.headingDeg === "number" ? Math.round(p.headingDeg) : null,
      recordedAt: at,
      metersFromPrev,
      minutesFromPrev,
      trusted,
      countsToDistance,
      isGap,
      gapFrom,
      gapVia,
    });

    cursor = { lat: p.lat, lng: p.lng, recordedAt: at };
    if (trusted) {
      anchor = cursor;
      sinceAnchor = [];
    } else {
      sinceAnchor.push({ lat: p.lat, lng: p.lng, accuracyM });
    }
  }

  return {
    points,
    rejected,
    untrusted,
    addedKm: addedM / 1000,
    lastAt: points.length ? points[points.length - 1].recordedAt : null,
  };
}
