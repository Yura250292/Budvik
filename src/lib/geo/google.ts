/**
 * Google як другий геокодер для клієнтів — там, де OSM не знає будинку.
 *
 * OSM у малих містах Львівщини часто не має навіть вулиці (у Бібрці нема
 * «Крушельницької»), а Google знає і будинки, і магазини за назвою. Тому
 * ланцюг такий: Nominatim → Google Geocoding → Google Places (за назвою
 * магазину з адреси) → чесний центр населеного пункту.
 *
 * Ключ — `GOOGLE_GEOCODING_KEY`, серверний, обмежений двома API (Geocoding і
 * Places API (New)). НЕ `NEXT_PUBLIC_GOOGLE_MAPS_KEY`: той браузерний,
 * прив'язаний до реферера й геокодування на ньому вимкнене. Без ключа обидві
 * функції повертають null — ланцюг просто закінчується на OSM.
 */

import { haversineM } from "@/lib/track/geo";
import { inBox, type GeoBox } from "./region";
import { mentionsSettlement, type GeoPrecision } from "./nominatim";

export type GoogleHit = {
  lat: number;
  lng: number;
  label: string;
  precision: GeoPrecision;
};

export function googleKey(): string | null {
  return process.env.GOOGLE_GEOCODING_KEY?.trim() || null;
}

type GeocodeResult = {
  formatted_address: string;
  types: string[];
  partial_match?: boolean;
  geometry: { location: { lat: number; lng: number }; location_type: string };
  address_components: Array<{ long_name: string; short_name: string; types: string[] }>;
};

/**
 * Geocoding API. Приймаємо лише будинок (ROOFTOP / RANGE_INTERPOLATED) — усе
 * грубіше OSM уже дав. І лише якщо серед компонентів є наш населений пункт:
 * Google охоче «виправляє» адресу на однойменну вулицю в сусідньому місті.
 */
export async function googleGeocode(
  address: string,
  opts: { box?: GeoBox; settlement?: string | null } = {}
): Promise<GoogleHit | null> {
  const key = googleKey();
  if (!key) return null;

  const params = new URLSearchParams({ address, language: "uk", region: "ua", key });
  if (opts.box) {
    const b = opts.box;
    params.set("bounds", `${b.south},${b.west}|${b.north},${b.east}`);
  }
  const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { status: string; error_message?: string; results?: GeocodeResult[] };
  if (data.status === "REQUEST_DENIED" || data.status === "OVER_QUERY_LIMIT") {
    throw new Error(`Google Geocoding: ${data.status} ${data.error_message ?? ""}`.trim());
  }

  for (const r of data.results ?? []) {
    const { lat, lng } = r.geometry.location;
    if (opts.box && !inBox(opts.box, lat, lng)) continue;
    if (!["ROOFTOP", "RANGE_INTERPOLATED"].includes(r.geometry.location_type)) continue;
    if (opts.settlement) {
      const parts = r.address_components.map((c) => c.long_name).join(",");
      if (!mentionsSettlement(parts, opts.settlement)) continue;
    }
    return { lat, lng, label: r.formatted_address, precision: "HOUSE" };
  }
  return null;
}

type Place = {
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
};

/**
 * Places API (New), Text Search: заклад за назвою біля центру пункту.
 * «Садиба, Стрий» → магазин «Садиба» на Зеленій. Приймаємо лише в межах
 * `radiusM` від центру: інакше мережевий магазин знаходиться в іншому місті.
 */
export async function googlePlace(
  query: string,
  near: { lat: number; lng: number },
  radiusM = 3000
): Promise<GoogleHit | null> {
  const key = googleKey();
  if (!key) return null;

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: "uk",
      regionCode: "UA",
      pageSize: 5,
      locationBias: {
        circle: { center: { latitude: near.lat, longitude: near.lng }, radius: Math.min(radiusM * 2, 50_000) },
      },
    }),
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error(`Google Places: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  if (!res.ok) return null;
  const data = (await res.json()) as { places?: Place[] };

  for (const p of data.places ?? []) {
    if (!p.location) continue;
    const hit = { lat: p.location.latitude, lng: p.location.longitude };
    if (haversineM(hit.lat, hit.lng, near.lat, near.lng) > radiusM) continue;
    return {
      ...hit,
      label: [p.displayName?.text, p.formattedAddress].filter(Boolean).join(", "),
      precision: "HOUSE",
    };
  }
  return null;
}
