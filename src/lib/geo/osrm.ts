const OSRM_URL = "https://router.project-osrm.org";

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

  const res = await fetch(url);
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

  const res = await fetch(url);
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
