const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "Budvik-ERP/1.0 (delivery route planner)";

// In-memory cache to avoid duplicate lookups
const cache = new Map<string, { lat: number; lng: number; displayName: string }>();

// Rate-limit: track last request time
let lastRequestTime = 0;

async function waitForRateLimit() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastRequestTime = Date.now();
}

/** Expand Ukrainian abbreviations for better Nominatim matching */
function expandAbbreviations(address: string): string {
  return address
    .replace(/\bвул\.\s*/gi, "вулиця ")
    .replace(/\bпров\.\s*/gi, "провулок ")
    .replace(/\bпросп\.\s*/gi, "проспект ")
    .replace(/\bбульв\.\s*/gi, "бульвар ")
    .replace(/\bпл\.\s*/gi, "площа ")
    .replace(/\bр-н\b/gi, "район")
    .replace(/\bобл\.\s*/gi, "область ")
    .replace(/\bс\.\s*/gi, "село ")
    .replace(/\bсмт\.\s*/gi, "")
    .replace(/\bм\.\s+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip abbreviations entirely for a looser search */
function stripAbbreviations(address: string): string {
  return address
    .replace(/\b(вул\.|вулиця|пров\.|провулок|просп\.|проспект|бульв\.|бульвар|пл\.|площа|р-н|район|обл\.|область|с\.|село|смт\.?|м\.)\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Try a single Nominatim search query */
async function nominatimSearch(
  query: string,
  options?: { structured?: boolean; country?: string }
): Promise<{ lat: number; lng: number; displayName: string } | null> {
  await waitForRateLimit();

  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: "3",
    "accept-language": "uk",
  });

  if (options?.country) {
    params.set("countrycodes", options.country);
  }

  const res = await fetch(`${NOMINATIM_URL}/search?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!data.length) return null;

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    displayName: data[0].display_name as string,
  };
}

/** Extract possible city/region from address for context */
function extractCity(address: string): string | null {
  // Common pattern: "City, street, number" — take first comma-separated part
  const parts = address.split(",").map((p) => p.trim());
  if (parts.length >= 2) return parts[0];
  return null;
}

/** Generate search variants by reordering parts */
function generateVariants(address: string): string[] {
  const variants: string[] = [];
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);

  if (parts.length >= 2) {
    // Reverse order: "Поршна, 8" → "8 Поршна"
    variants.push(parts.reverse().join(" "));
    // "Street Number, City" style — try "City Street Number"
    variants.push(parts.join(", "));
  }

  // If it looks like "Street, Number" (short), try with common cities
  if (parts.length <= 2 && address.length < 30) {
    const commonCities = ["Вінниця", "Київ", "Хмельницький"];
    const stripped = stripAbbreviations(address);
    for (const city of commonCities) {
      if (!address.toLowerCase().includes(city.toLowerCase())) {
        variants.push(`${city}, ${stripped}`);
      }
    }
  }

  return variants;
}

/**
 * Geocode an address using multiple fallback strategies:
 * 1. Original text with Ukraine filter
 * 2. Expanded abbreviations with Ukraine filter
 * 3. Stripped abbreviations with Ukraine filter
 * 4. Add "Україна" suffix for context
 * 5. Reordered parts / city appended
 * 6. Without country filter (global search)
 */
export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number; displayName: string } | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const cacheKey = trimmed.toLowerCase();
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  const expanded = expandAbbreviations(trimmed);
  const stripped = stripAbbreviations(trimmed);

  // Strategy 1: original text, Ukraine
  let result = await nominatimSearch(trimmed, { country: "ua" });

  // Strategy 2: expanded abbreviations, Ukraine
  if (!result && expanded !== trimmed) {
    result = await nominatimSearch(expanded, { country: "ua" });
  }

  // Strategy 3: stripped abbreviations, Ukraine
  if (!result && stripped !== trimmed && stripped !== expanded) {
    result = await nominatimSearch(stripped, { country: "ua" });
  }

  // Strategy 4: append "Україна" for better context
  if (!result) {
    const withCountry = `${stripped}, Україна`;
    result = await nominatimSearch(withCountry);
  }

  // Strategy 5: reordered variants and city-appended searches
  if (!result) {
    const variants = generateVariants(trimmed);
    for (const variant of variants) {
      result = await nominatimSearch(variant, { country: "ua" });
      if (result) break;
    }
  }

  // Strategy 6: global search as last resort
  if (!result) {
    result = await nominatimSearch(trimmed);
  }

  if (result) {
    cache.set(cacheKey, result);
  }

  return result;
}

export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<{ lat: number; lng: number; displayName: string; shortName: string } | null> {
  await waitForRateLimit();

  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lng.toString(),
    format: "json",
    "accept-language": "uk",
    zoom: "18",
  });

  const res = await fetch(`${NOMINATIM_URL}/reverse?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!data || data.error) return null;

  // Build short name from address parts
  const addr = data.address || {};
  const parts = [
    addr.city || addr.town || addr.village || "",
    addr.road || "",
    addr.house_number || "",
  ].filter(Boolean);

  return {
    lat,
    lng,
    displayName: data.display_name || "",
    shortName: parts.join(", ") || data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
  };
}

export async function geocodeAddresses(
  addresses: string[]
): Promise<Array<{ address: string; lat: number; lng: number; displayName: string } | null>> {
  const results: Array<{ address: string; lat: number; lng: number; displayName: string } | null> = [];
  for (const address of addresses) {
    const geo = await geocodeAddress(address);
    results.push(geo ? { address, ...geo } : null);
  }
  return results;
}
