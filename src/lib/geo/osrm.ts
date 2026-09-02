/**
 * Адреса OSRM. За замовчуванням — публічний демо-сервер, і це його межі:
 * `/match` приймає РІВНО 10 координат (11 уже «TooBig»), запити лімітовані за
 * частотою, а на розріджений слід він віддає впевненість 0,00. Для доби з
 * семисот точок це означає під вісімдесят запитів і сумнівний результат.
 *
 * Власний OSRM з викачкою по Україні знімає обидва обмеження: доба лягає одним
 * запитом, і та сама залежність перестає бути найслабшою ланкою в прийомі
 * треку. Тому адреса — змінна оточення: перемикання займає один рядок.
 */
const OSRM_URL = process.env.OSRM_URL ?? "https://router.project-osrm.org";

/**
 * Скільки чекаємо на публічний демо-сервер OSRM.
 *
 * Без межі жоден із цих викликів не завершується ніколи, якщо з'єднання
 * зависло, — а вони стоять усередині прийому треку, тобто тримають запит
 * планшета. Саме такий безмежний `fetch` 01.09 годинами тримав замок відправки
 * на пристроях; повторювати ту саму помилку на сервері не варто.
 */
const OSRM_TIMEOUT_MS = 8_000;

async function osrmFetch(url: string, timeoutMs = OSRM_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Точка сліду для прив'язки до дороги: координата й похибка фікса. */
export type MatchPoint = { lng: number; lat: number; accuracyM?: number | null };

/**
 * Кладе сирий слід GPS на граф доріг (map matching).
 *
 * `/route` прокладає шлях МІЖ двома точками, а `/match` бере ЦІЛИЙ слід і
 * знаходить послідовність доріг, якою людина найімовірніше їхала. Це те, що
 * потрібно для карти: лінія лягає рівно по вулиці, а не ламаною між фіксами.
 *
 * `radiuses` — головний параметр. Він каже матчеру, наскільки довіряти кожній
 * точці: фікс із похибкою 8 м прив'яжеться до найближчої вулиці, а з похибкою
 * 90 м матиме право лягти на сусідню. Без нього матчер однаково довіряє всім і
 * впевнено кладе слід на паралельну дорогу — та сама вада, через яку домальовка
 * колись малювала петлі кварталами.
 *
 * `tidy=true` просить OSRM самому прибрати надто щільні й тремтячі точки:
 * стоянка з десятком фіксів на місці інакше дає безглузді мікропетлі.
 */
export async function matchTrace(
  points: MatchPoint[]
): Promise<{ line: GeoJSON.LineString; confidence: number } | null> {
  if (points.length < 2) return null;

  const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
  /**
   * Стеля радіуса — 50 м. Вище матчер починає «шукати кращу дорогу» за
   * квартал звідси; нижче 8 м — відкидає точку як таку, що не лягає на граф.
   */
  const radiuses = points
    .map((p) => Math.min(50, Math.max(8, Math.round(p.accuracyM ?? 15))))
    .join(";");

  const url =
    `${OSRM_URL}/match/v1/driving/${coords}` +
    `?geometries=geojson&overview=full&tidy=true&gaps=ignore&radiuses=${radiuses}`;

  const res = await osrmFetch(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.code !== "Ok" || !Array.isArray(data.matchings)) return null;

  /**
   * Матчер повертає кілька шматків, коли слід рветься (людина заїхала туди,
   * де доріг немає, або зникла на кілометр). Склеюємо їх по порядку: діра між
   * шматками лишиться прямою, і це чесно — там ми справді не знаємо дороги.
   */
  const line: [number, number][] = [];
  /**
   * Впевненість зважуємо довжиною: матчер віддає її окремо на кожен шматок, і
   * стометровий уривок із нулем не має важити стільки ж, скільки п'ять
   * кілометрів із 0,98. Саме за цим числом вирішується, малювати дорогу чи
   * лишити сиру лінію: впевнено покладений НЕ ТОЙ проїзд гірший за чесну
   * ламану — його ніхто не помітить.
   */
  let weighted = 0;
  let meters = 0;

  for (const m of data.matchings) {
    const coordsOut = m?.geometry?.coordinates;
    if (!Array.isArray(coordsOut)) continue;
    for (const c of coordsOut) line.push([c[0], c[1]]);
    const d = typeof m.distance === "number" ? m.distance : 0;
    weighted += (typeof m.confidence === "number" ? m.confidence : 0) * d;
    meters += d;
  }

  if (line.length < 2) return null;
  return {
    line: { type: "LineString", coordinates: line },
    confidence: meters > 0 ? weighted / meters : 0,
  };
}

interface OsrmRouteResult {
  totalDistanceKm: number;
  totalDurationMin: number;
  geometry: GeoJSON.LineString;
  legs: Array<{ distanceKm: number; durationMin: number }>;
}

interface OsrmTripResult extends OsrmRouteResult {
  waypointOrder: number[]; // indices in optimized order
}

function coordsToString(coords: [number, number][]): string {
  // OSRM expects lng,lat format
  return coords.map(([lng, lat]) => `${lng},${lat}`).join(";");
}

export async function getRoute(
  coords: [number, number][] // [lng, lat][]
): Promise<OsrmRouteResult> {
  const url = `${OSRM_URL}/route/v1/driving/${coordsToString(coords)}?overview=full&geometries=geojson`;

  const res = await osrmFetch(url);
  if (!res.ok) throw new Error(`OSRM route error: ${res.status}`);

  const data = await res.json();
  if (data.code !== "Ok") throw new Error(`OSRM: ${data.code} - ${data.message}`);

  const route = data.routes[0];
  return {
    totalDistanceKm: Math.round((route.distance / 1000) * 10) / 10,
    totalDurationMin: Math.round(route.duration / 60),
    geometry: route.geometry,
    legs: route.legs.map((leg: { distance: number; duration: number }) => ({
      distanceKm: Math.round((leg.distance / 1000) * 10) / 10,
      durationMin: Math.round(leg.duration / 60),
    })),
  };
}

export async function getOptimalTrip(
  coords: [number, number][] // [lng, lat][]
): Promise<OsrmTripResult> {
  // source=first: start from first point (warehouse)
  // roundtrip=false: don't return to start
  const url = `${OSRM_URL}/trip/v1/driving/${coordsToString(coords)}?source=first&roundtrip=false&geometries=geojson&overview=full`;

  const res = await osrmFetch(url);
  if (!res.ok) throw new Error(`OSRM trip error: ${res.status}`);

  const data = await res.json();
  if (data.code !== "Ok") throw new Error(`OSRM: ${data.code} - ${data.message}`);

  const trip = data.trips[0];
  const waypointOrder = data.waypoints.map((w: { waypoint_index: number }) => w.waypoint_index);

  return {
    totalDistanceKm: Math.round((trip.distance / 1000) * 10) / 10,
    totalDurationMin: Math.round(trip.duration / 60),
    geometry: trip.geometry,
    legs: trip.legs.map((leg: { distance: number; duration: number }) => ({
      distanceKm: Math.round((leg.distance / 1000) * 10) / 10,
      durationMin: Math.round(leg.duration / 60),
    })),
    waypointOrder,
  };
}
