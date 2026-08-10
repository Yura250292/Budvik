/**
 * Геокодування пунктів маршруту.
 *
 * Ключова проблема, знайдена на реальних даних: назви сіл в Україні
 * повторюються. «Лопатин» без області Nominatim знаходить у Вінницькій, а
 * «Витків» — у Рівненській, хоча обидва мали бути на Львівщині — маршрут
 * виходив 837 км замість ~150. Тому область обовʼязково додається до запиту:
 * або вказана в самому рядку («Лопатин, Львівська»), або з поля region
 * шаблону.
 */

import { geocodeAddresses } from "@/lib/geo/nominatim";
import { getRoute } from "@/lib/geo/osrm";

export const MAX_STOPS = 20;

export type GeocodedStop = {
  settlement: string;
  displayName: string | null;
  lat: number;
  lng: number;
  seq: number;
};

/** Рядок уже містить уточнення (кому з областю/районом)? */
function hasContext(value: string): boolean {
  return value.includes(",");
}

/**
 * Формує запит до Nominatim: «Радехів» + region «Львівська» →
 * «Радехів, Львівська область, Україна».
 */
export function buildQuery(settlement: string, region?: string | null): string {
  const parts = [settlement];

  if (!hasContext(settlement) && region?.trim()) {
    const r = region.trim();
    parts.push(/обл/i.test(r) ? r : `${r} область`);
  }
  if (!/україна/i.test(settlement)) parts.push("Україна");

  return parts.join(", ");
}

/**
 * Геокодує список пунктів і будує геометрію маршруту.
 *
 * known — уже відомі пункти (з попереднього збереження шаблону): їх не
 * перезапитуємо, бо кожен запит — зайва секунда очікування rate-limit і
 * ризик іншої відповіді для того ж села.
 */
export async function geocodeStops(
  settlements: string[],
  region: string | null,
  known: Map<string, GeocodedStop> = new Map()
): Promise<{
  stops: GeocodedStop[];
  failed: string[];
  routeGeometry: unknown;
  totalDistanceKm: number | null;
}> {
  const cleaned = settlements.map((s) => s.trim()).filter(Boolean).slice(0, MAX_STOPS);

  const unknown = cleaned.filter((s) => !known.has(s.toLowerCase()));
  const geocoded = unknown.length
    ? await geocodeAddresses(unknown.map((s) => buildQuery(s, region)))
    : [];
  const geoByName = new Map(unknown.map((name, i) => [name.toLowerCase(), geocoded[i]] as const));

  const stops: GeocodedStop[] = [];
  const failed: string[] = [];

  for (const settlement of cleaned) {
    const cached = known.get(settlement.toLowerCase());
    if (cached) {
      stops.push({ ...cached, seq: stops.length });
      continue;
    }

    const point = geoByName.get(settlement.toLowerCase());
    if (point) {
      stops.push({
        settlement,
        displayName: point.displayName,
        lat: point.lat,
        lng: point.lng,
        seq: stops.length,
      });
    } else {
      failed.push(settlement);
    }
  }

  let routeGeometry: unknown = null;
  let totalDistanceKm: number | null = null;

  // OSRM не критичний: без нього мапа покаже маркери й пряму лінію між ними.
  if (stops.length >= 2) {
    try {
      const route = await getRoute(stops.map((s) => [s.lng, s.lat] as [number, number]));
      routeGeometry = route.geometry;
      totalDistanceKm = route.totalDistanceKm;
    } catch {
      routeGeometry = null;
    }
  }

  return { stops, failed, routeGeometry, totalDistanceKm };
}
