/**
 * Посилання на Google Maps по затвердженому порядку точок.
 *
 * Google приймає щонайбільше ~10 точок на посилання (початок + 8
 * проміжних + кінець), а в денному маршруті їх буває 25. Тому ділимо на
 * частини: кожна наступна стартує з останньої точки попередньої — водій
 * доїхав до кінця частини 1, відкрив частину 2 і поїхав далі без розриву.
 *
 * Спільний модуль, бо ці посилання потрібні у двох місцях: логісту в
 * планувальнику і водієві на екрані дня. Дві копії розійшлися б на
 * першій же зміні ліміту.
 */

export const MAX_POINTS_PER_LINK = 10;

export type MapPoint = { lat: number; lng: number };

/** Одна частина маршруту: посилання і скільки точок у ньому. */
export type MapLink = {
  url: string;
  /** Скільки точок відкриє це посилання (включно зі стартовою) */
  points: number;
};

/**
 * Ділить точки на посилання Google Maps.
 * Менше двох точок — порожній масив: маршруту з однієї точки не буває.
 */
export function googleMapsLinks(points: MapPoint[]): MapLink[] {
  return splitIntoLinks(points, directionsUrl);
}

/** Те саме, але посиланнями-шляхами — форма для пересилання водієві. */
export function googleMapsPathLinks(points: MapPoint[]): MapLink[] {
  return splitIntoLinks(points, pathDirectionsUrl);
}

function splitIntoLinks(
  points: MapPoint[],
  build: (chunk: MapPoint[]) => string
): MapLink[] {
  const links: MapLink[] = [];
  let i = 0;
  while (i < points.length - 1) {
    const chunk = points.slice(i, i + MAX_POINTS_PER_LINK);
    links.push({ url: build(chunk), points: chunk.length });
    i += MAX_POINTS_PER_LINK - 1;
  }
  return links;
}

/** Посилання «прокласти дорогу» через усі задані точки по порядку. */
export function directionsUrl(points: MapPoint[]): string {
  const origin = points[0];
  const dest = points[points.length - 1];
  const waypoints = points
    .slice(1, -1)
    .map((p) => `${p.lat},${p.lng}`)
    .join("|");

  return (
    `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}` +
    `&destination=${dest.lat},${dest.lng}` +
    (waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : "") +
    `&travelmode=driving`
  );
}

/**
 * Посилання-шлях: /maps/dir/точка/точка/…
 *
 * Друга форма того самого маршруту, і саме її ми даємо людині в руки.
 * Причина проста: 02.09 власник перевірив обидві на своєму телефоні, і
 * дорогу через усі шість точок побудувала ця. Форма з api=1 лишається для
 * застосунку й планувальника — там посилання відкриває сам застосунок, а
 * не месенджер.
 *
 * Координати ріжемо до шести знаків (≈0,1 м): довші хвости точності не
 * додають, зате роблять посилання таким, що месенджери його переносять.
 */
export function pathDirectionsUrl(points: MapPoint[]): string {
  return (
    "https://www.google.com/maps/dir/" +
    points.map((p) => `${round(p.lat)},${round(p.lng)}`).join("/")
  );
}

/** Шість знаків після коми — приблизно 0,1 метра. */
function round(v: number): number {
  return Number(v.toFixed(6));
}

/** Посилання на одну точку — «довези мене сюди». */
export function pointUrl(point: MapPoint): string {
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&destination=${point.lat},${point.lng}&travelmode=driving`
  );
}
