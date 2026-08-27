/**
 * Посилання на Google Maps по затвердженому порядку точок.
 *
 * Копія src/lib/maps/google-links.ts із сайту. Копія, а не імпорт: застосунок
 * не має доступу до коду сайту, і тягнути його через спільний пакет заради
 * тридцяти рядків чистих функцій дорожче, ніж тримати дублікат.
 *
 * Ціна дубля відома: зміна ліміту Google доведеться внести у ДВА місця.
 * Ліміт цей стабільний роками, а розбіжність одразу видно — водій відкриє
 * посилання й побачить не ті адреси.
 */

export const MAX_POINTS_PER_LINK = 10;

export type MapPoint = { lat: number; lng: number };

/** Одна частина маршруту: посилання і скільки точок у ньому. */
export type MapLink = { url: string; points: number };

/**
 * Ділить точки на посилання Google Maps.
 *
 * Google приймає щонайбільше ~10 точок на посилання (початок + 8 проміжних +
 * кінець), а в денному маршруті їх буває 25. Кожна наступна частина стартує з
 * останньої точки попередньої — водій доїхав до кінця частини 1, відкрив
 * частину 2 і поїхав далі без розриву.
 *
 * Менше двох точок — порожній масив: маршруту з однієї точки не буває.
 */
export function googleMapsLinks(points: MapPoint[]): MapLink[] {
  const links: MapLink[] = [];
  let i = 0;
  while (i < points.length - 1) {
    const chunk = points.slice(i, i + MAX_POINTS_PER_LINK);
    links.push({ url: directionsUrl(chunk), points: chunk.length });
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

/** Посилання на одну точку — «довези мене сюди». */
export function pointUrl(point: MapPoint): string {
  return (
    `https://www.google.com/maps/dir/?api=1` +
    `&destination=${point.lat},${point.lng}&travelmode=driving`
  );
}
