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

function normalizeAddress(address: string): string {
  return address
    .replace(/\bвул\.\s*/gi, "вулиця ")
    .replace(/\bпров\.\s*/gi, "провулок ")
    .replace(/\bпросп\.\s*/gi, "проспект ")
    .replace(/\bм\.\s*/gi, "")
    .replace(/\bбульв\.\s*/gi, "бульвар ")
    .replace(/\bпл\.\s*/gi, "площа ")
    .trim();
}

export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number; displayName: string } | null> {
  const normalized = normalizeAddress(address);
  const cacheKey = normalized.toLowerCase();

  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  await waitForRateLimit();

  const params = new URLSearchParams({
    q: normalized,
    format: "json",
    limit: "1",
    countrycodes: "ua",
    "accept-language": "uk",
  });

  const res = await fetch(`${NOMINATIM_URL}/search?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!data.length) return null;

  const result = {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    displayName: data[0].display_name as string,
  };

  cache.set(cacheKey, result);
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
