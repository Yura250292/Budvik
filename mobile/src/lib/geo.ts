/**
 * Відстань між двома точками по прямій, у метрах.
 *
 * Копія `haversineM` із сайту (src/lib/track/geo.ts) — застосунок не має
 * доступу до коду сайту, а число потрібне тут: екран дня питає «водій уже
 * біля клієнта?», і питає це на кожен фікс, без мережі.
 *
 * По прямій, а не дорогою: для «сто метрів чи кілометр» цього досить, а
 * дорога коштувала б запиту в OSRM у кожній точці маршруту.
 */

const EARTH_R = 6_371_000;

export function haversineM(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}
