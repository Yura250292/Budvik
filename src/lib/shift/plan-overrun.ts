/**
 * Перевитрата пробігу зміни проти призначеного маршруту.
 *
 * Питання, на яке відповідає модуль: торговий намотав більше, ніж мав за
 * планом, — і наскільки. Не «чи їхав він тією дорогою» (це рахує
 * lib/sales/deviation.ts через коридор), а саме СКІЛЬКИ зайвих кілометрів.
 *
 * Чому окремо від відхилення вбік. Дві різні провини, які легко сплутати.
 * Можна не вийти з коридору жодного разу і при цьому намотати вдвічі
 * більше — просто проїхавши той самий напрямок туди-сюди тричі. І навпаки:
 * заїзд до клієнта за 3 км від траси дає епізод убік, але нуль зайвих
 * кілометрів. Тому в UI обидві цифри стоять поруч, а не заміняють одна одну.
 *
 * Базою беремо ОДОМЕТР, а не GPS-трек. Одометр — те, за що платять, і те,
 * що не залежить від якості звʼязку: трек із дірками завжди занижений
 * (планшет був офлайн — у пробіг пішла пряма), і порівняння плану з ним
 * системно виправдовувало б перевитрату.
 */

/**
 * На скільки відсотків факт може перевищити план, лишаючись нормою.
 *
 * План — це лінія між пунктами напрямку. Реальний день завжди довший:
 * дорога від дому до першого пункту, заїзди у двори, розвороти, об'їзд
 * ремонту. Десять відсотків — та фора, яка покриває це і не покриває
 * поїздку у своїх справах.
 */
export const OVERRUN_THRESHOLD_PCT = 10;

export type PlanOverrun = {
  /** Планові км маршруту (з OSRM-геометрії шаблону) */
  plannedKm: number;
  /** Фактичні км зміни за одометром */
  actualKm: number;
  /** Зайві км понад план; від'ємне означає, що проїхав менше */
  extraKm: number;
  /** Перевищення у відсотках від плану */
  overrunPct: number;
  /** Чи перетнуто поріг */
  exceeded: boolean;
};

/**
 * Наскільки близько до пункту треба проїхати, щоб зарахувати відвідання.
 *
 * Пункт маршруту — це населений пункт, а не двері: Nominatim ставить точку
 * в його умовний центр, тоді як клієнти стоять на околицях, на об'їзній і
 * в промзоні за кілька кілометрів. Тому радіус мусить бути щедрим.
 *
 * Але одного числа на всі маршрути не буває, і це видно на реальних даних.
 * Торговий, що весь день працював у Львові, опинявся за 4,6 км від «центру
 * Львова» — три кілометри зарахували б йому нуль відвіданих пунктів, хоча
 * він у тому пункті й був. А на тому ж маршруті Борислав і Трускавець
 * стоять за 6,7 км один від одного — вісім кілометрів зараховували б обидва
 * за візит у будь-який один.
 *
 * Тому радіус рахується від САМОГО МАРШРУТУ: половина відстані до
 * найближчого сусіднього пункту, обрізана знизу й зверху. Так у щільному
 * кущі міст радіуси не перекриваються за побудовою, а на розрідженому
 * маршруті великому місту дістається чесна фора.
 */
export const STOP_REACHED_MIN_M = 2500;
export const STOP_REACHED_MAX_M = 8000;

/**
 * Радіус зарахування для кожного пункту окремо.
 *
 * Ділимо навпіл саме тому, що межа між двома сусідами має проходити
 * посередині: інакше два кола накрили б одну й ту саму точку треку, і
 * «був у Бориславі» автоматично означало б «був і в Трускавці».
 */
export function stopRadii(
  stops: Array<{ lat: number; lng: number }>,
  minM: number = STOP_REACHED_MIN_M,
  maxM: number = STOP_REACHED_MAX_M
): number[] {
  return stops.map((s, i) => {
    let nearest = Infinity;
    stops.forEach((o, j) => {
      if (i === j) return;
      const d = haversineM(s.lat, s.lng, o.lat, o.lng);
      // Нульова відстань — це той самий пункт, записаний двічі (маршрут
      // «Львів → … → Львів»): він не сусід сам собі й радіус не звужує.
      if (d > 1 && d < nearest) nearest = d;
    });
    if (!Number.isFinite(nearest)) return maxM;
    return Math.max(minM, Math.min(maxM, nearest / 2));
  });
}

export type StopCoverage = {
  /** Скільки пунктів плану торговий реально проїхав */
  visited: number;
  total: number;
  /** Назви пунктів, до яких він не доїхав */
  missed: string[];
};

/**
 * Скільки пунктів маршруту трек реально зачепив.
 *
 * Окрема відповідь від перевитрати, і зливати їх в один відсоток не можна.
 * Недоїзд і перевитрата — різні провини: можна проїхати всі пункти й
 * намотати вдвічі більше (крутився), а можна не перевищити жодного
 * кілометра, бо просто нікуди не поїхав. Один показник приховав би обидві.
 */
export function computeStopCoverage(
  stops: Array<{ settlement: string; lat: number; lng: number }>,
  points: Array<{ lat: number; lng: number }>
): StopCoverage | null {
  if (stops.length === 0) return null;

  const radii = stopRadii(stops);
  const missed: string[] = [];
  let visited = 0;

  stops.forEach((stop, i) => {
    const reached = points.some(
      (p) => haversineM(p.lat, p.lng, stop.lat, stop.lng) <= radii[i]
    );
    if (reached) visited++;
    // Маршрут «Львів → … → Львів» повертається в той самий пункт: у
    // списку недоїханих він має стояти один раз, а не двічі.
    else if (!missed.includes(stop.settlement)) missed.push(stop.settlement);
  });

  return { visited, total: stops.length, missed };
}

const EARTH_R = 6_371_000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Відстань між двома координатами, метри. */
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

/**
 * Рахує перевитрату. null, коли порівнювати нема з чим.
 *
 * Нульовий або відсутній план — не «перевитрата 100%», а відсутність
 * відповіді: маршрут без порахованих кілометрів (геокодування не влучило,
 * OSRM не відповів при створенні) не може нікого звинувачувати.
 */
export function computeOverrun(
  actualKm: number | null,
  plannedKm: number | null
): PlanOverrun | null {
  if (actualKm == null || plannedKm == null || plannedKm <= 0) return null;

  const extraKm = actualKm - plannedKm;
  const overrunPct = (extraKm / plannedKm) * 100;

  return {
    plannedKm: Math.round(plannedKm * 10) / 10,
    actualKm: Math.round(actualKm * 10) / 10,
    extraKm: Math.round(extraKm * 10) / 10,
    overrunPct: Math.round(overrunPct),
    exceeded: overrunPct > OVERRUN_THRESHOLD_PCT,
  };
}
