/**
 * Відхилення фактичного треку від призначеного маршруту.
 *
 * Навіщо. Одометр каже, СКІЛЬКИ намотано, трек — ДЕ. Але сам по собі трек
 * ще не звинувачення: маршрут «Радехів» на мапі і реальна дорога туди —
 * різні лінії, бо OSRM веде трасою, а торговий може об'їхати ремонт.
 * Тому питання не «чи збігається трек із планом», а «чи є кілометри, які
 * планом не пояснюються».
 *
 * ГОЛОВНЕ РІШЕННЯ, з якого випливає вся математика нижче.
 *
 * Корки й аварії коштують ЧАСУ, а не ВІДСТАНІ. Стояння в заторі дає нуль
 * зайвих кілометрів і годину втраченого часу; об'їзд аварії — кілька
 * кілометрів у межах того самого напрямку. А поїздка у своїх справах дає
 * саме зайві кілометри, і саме ВБІК від маршруту.
 *
 * Тому:
 *   • перевищення ЧАСУ ніколи не є відхиленням — це і є корки;
 *   • відхилення міряємо ВІДСТАННЮ ВБІК від коридору маршруту;
 *   • одиночні точки за межами коридору ігноруємо (шум GPS, об'їзд);
 *   • тривогу дає лише стійкий вихід: далеко І надовго.
 */

/** Точка треку в тому вигляді, в якому вона потрібна аналізу. */
export type TrackPoint = {
  lat: number;
  lng: number;
  accuracyM: number | null;
  recordedAt: Date;
};

/** Вузол планового маршруту (пункт або точка полілінії OSRM). */
export type RouteNode = { lat: number; lng: number };

/**
 * Ширина коридору маршруту — скільки метрів убік вважається «на маршруті».
 *
 * Не менше кількох сотень метрів: планова лінія йде центром дороги, а
 * клієнти стоять на околицях сіл, у дворах і на об'їзних. Вузький коридор
 * зробив би порушником кожного, хто просто заїхав до клієнта.
 */
export const CORRIDOR_M = 1500;

/**
 * Скільки хвилин поспіль треба бути поза коридором, щоб це стало епізодом.
 *
 * Об'їзд аварії або затор на розв'язці виводять трек убік на кілька хвилин.
 * Поїздка у своїх справах — це десятки хвилин. Поріг відсікає перше.
 */
export const EXCURSION_MIN_MINUTES = 25;

/**
 * І скільки кілометрів має бути намотано поза коридором. Обидві умови
 * разом: постояти 40 хвилин трохи збоку від траси (обід, СТО, черга на
 * заправці) — не порушення, якщо машина при цьому нікуди не їхала.
 */
export const EXCURSION_MIN_KM = 8;

/** Похибка GPS, вище якої точка не може доводити вихід за коридор. */
const ACCURACY_TRUST_M = 200;

const EARTH_R = 6_371_000;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

/**
 * Відстань від точки до відрізка — саме вона, а не відстань до вузлів.
 *
 * Через вузли міряти не можна: між двома сусідніми пунктами маршруту
 * бувають десятки кілометрів, і торговий, що їде рівно по трасі рівно за
 * планом, опинявся б «за 20 км від найближчого пункту».
 *
 * Проєкція рахується в локальних метрах (плоска аппроксимація): на
 * масштабах відрізка маршруту кривина Землі дає похибку менше метра.
 */
export function distanceToSegmentM(
  p: { lat: number; lng: number },
  a: RouteNode,
  b: RouteNode
): number {
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(toRad(p.lat));

  const px = (p.lng - a.lng) * mPerDegLng;
  const py = (p.lat - a.lat) * mPerDegLat;
  const bx = (b.lng - a.lng) * mPerDegLng;
  const by = (b.lat - a.lat) * mPerDegLat;

  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return Math.hypot(px, py);

  // t — проєкція на відрізок, обрізана краями: точка навпроти середини
  // відрізка міряється до перпендикуляра, а не до кінців.
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Мінімальна відстань від точки до всієї планової лінії. */
export function distanceToRouteM(
  p: { lat: number; lng: number },
  route: RouteNode[]
): number {
  if (route.length === 0) return Infinity;
  if (route.length === 1) return haversineMeters(p.lat, p.lng, route[0].lat, route[0].lng);

  let min = Infinity;
  for (let i = 1; i < route.length; i++) {
    const d = distanceToSegmentM(p, route[i - 1], route[i]);
    if (d < min) min = d;
  }
  return min;
}

/** Епізод виходу за межі коридору маршруту. */
export type Excursion = {
  from: Date;
  to: Date;
  minutes: number;
  /** Кілометри, намотані поза коридором */
  km: number;
  /** Найдальша відстань від маршруту, м */
  maxDistanceM: number;
  /** Центр епізоду — щоб показати на мапі й підписати адресою */
  lat: number;
  lng: number;
};

export type DeviationResult = {
  /** Чи був призначений маршрут узагалі */
  hasRoute: boolean;
  /** Частка точок у межах коридору (0..1) */
  onRouteRatio: number | null;
  /** Кілометри поза коридором сумарно */
  offRouteKm: number;
  /** Значущі епізоди — саме вони йдуть в алерт */
  excursions: Excursion[];
  pointsAnalyzed: number;
};

/**
 * Порівняння треку з планом.
 *
 * Повертає факти, а не вирок: рішення «це порушення» ухвалює людина,
 * дивлячись на епізоди. Функція лише каже, куди дивитися.
 */
export function analyzeDeviation(
  points: TrackPoint[],
  route: RouteNode[],
  opts: { corridorM?: number } = {}
): DeviationResult {
  const corridor = opts.corridorM ?? CORRIDOR_M;

  if (route.length === 0 || points.length < 2) {
    return {
      hasRoute: route.length > 0,
      onRouteRatio: null,
      offRouteKm: 0,
      excursions: [],
      pointsAnalyzed: points.length,
    };
  }

  const sorted = [...points].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime()
  );

  // Крок 1: позначаємо кожну точку. Погана точність не може доводити
  // вихід — розширюємо коридор на її похибку, а не відкидаємо точку:
  // відкинута точка розірвала б епізод навпіл.
  const flags = sorted.map((p) => {
    const d = distanceToRouteM(p, route);
    const slack = p.accuracyM != null && p.accuracyM > ACCURACY_TRUST_M ? p.accuracyM : 0;
    return { point: p, distance: d, off: d > corridor + slack };
  });

  const onRoute = flags.filter((f) => !f.off).length;

  // Крок 2: збираємо суміжні off-точки в епізоди.
  const excursions: Excursion[] = [];
  let offRouteMeters = 0;
  let current: typeof flags = [];

  const flush = () => {
    if (current.length < 2) {
      current = [];
      return;
    }

    const first = current[0];
    const last = current[current.length - 1];
    const minutes = Math.round(
      (last.point.recordedAt.getTime() - first.point.recordedAt.getTime()) / 60000
    );

    let meters = 0;
    for (let i = 1; i < current.length; i++) {
      meters += haversineMeters(
        current[i - 1].point.lat,
        current[i - 1].point.lng,
        current[i].point.lat,
        current[i].point.lng
      );
    }
    offRouteMeters += meters;

    const far = current.reduce((m, f) => Math.max(m, f.distance), 0);

    // Обидві умови разом — див. коментарі до порогів вище.
    if (minutes >= EXCURSION_MIN_MINUTES && meters / 1000 >= EXCURSION_MIN_KM) {
      const mid = current[Math.floor(current.length / 2)].point;
      excursions.push({
        from: first.point.recordedAt,
        to: last.point.recordedAt,
        minutes,
        km: Math.round(meters / 1000),
        maxDistanceM: Math.round(far),
        lat: mid.lat,
        lng: mid.lng,
      });
    }
    current = [];
  };

  for (const f of flags) {
    if (f.off) current.push(f);
    else flush();
  }
  flush();

  return {
    hasRoute: true,
    onRouteRatio: flags.length ? Number((onRoute / flags.length).toFixed(2)) : null,
    offRouteKm: Math.round(offRouteMeters / 1000),
    excursions,
    pointsAnalyzed: flags.length,
  };
}

/**
 * Планова лінія з шаблону маршруту.
 *
 * Пріоритет у геометрії OSRM: вона йде реальними дорогами, і коридор
 * навколо неї осмислений. Пряма між пунктами — запасний варіант, який
 * ріже кути й дає хибні «відхилення» на кожному вигині траси, тому при
 * ній коридор доводиться розширювати (див. виклик у route-day).
 */
export function routeNodesFromTemplate(
  geometry: unknown,
  stops: Array<{ lat: number; lng: number }>
): { nodes: RouteNode[]; fromGeometry: boolean } {
  const geo = geometry as { type?: string; coordinates?: [number, number][] } | null;

  if (geo?.coordinates?.length && geo.coordinates.length >= 2) {
    // GeoJSON — [lng, lat]
    return {
      nodes: geo.coordinates.map(([lng, lat]) => ({ lat, lng })),
      fromGeometry: true,
    };
  }

  return { nodes: stops.map((s) => ({ lat: s.lat, lng: s.lng })), fromGeometry: false };
}
