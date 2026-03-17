import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/geo/nominatim";
import { getOptimalTrip, getRoute } from "@/lib/geo/osrm";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { startAddress, addresses, startCoords, addressCoords } = body as {
      startAddress: string;
      addresses: string[];
      startCoords?: { lat: number; lng: number } | null;
      addressCoords?: Array<{ lat: number; lng: number } | null>;
    };

    if (!startAddress || !addresses || addresses.length < 1) {
      return NextResponse.json(
        { error: "Потрібна початкова адреса та хоча б 1 адреса доставки" },
        { status: 400 }
      );
    }

    // Geocode all addresses (start + stops), using pre-geocoded coords when available
    const allAddresses = [startAddress, ...addresses];
    const preCoords = [startCoords || null, ...(addressCoords || addresses.map(() => null))];
    const geocoded: Array<{
      address: string;
      lat: number;
      lng: number;
      displayName: string;
    } | null> = [];

    for (let i = 0; i < allAddresses.length; i++) {
      const addr = allAddresses[i];
      const pre = preCoords[i];
      if (pre) {
        // Use pre-geocoded coordinates
        geocoded.push({ address: addr, lat: pre.lat, lng: pre.lng, displayName: addr });
      } else {
        const result = await geocodeAddress(addr);
        geocoded.push(result ? { address: addr, ...result } : null);
      }
    }

    // Check for failed geocoding
    const failed = allAddresses.filter((_, i) => !geocoded[i]);
    if (failed.length > 0) {
      return NextResponse.json(
        {
          error: `Не вдалось знайти адреси: ${failed.join("; ")}`,
          failedAddresses: failed,
        },
        { status: 400 }
      );
    }

    const validGeocoded = geocoded as NonNullable<(typeof geocoded)[0]>[];
    const coords: [number, number][] = validGeocoded.map((g) => [g.lng, g.lat]);

    // If only 1 delivery address (+ start = 2 points), just get route
    if (addresses.length === 1) {
      const routeResult = await getRoute(coords);
      return NextResponse.json({
        optimizedAddresses: [
          { ...validGeocoded[0], type: "start" },
          { ...validGeocoded[1], type: "stop", sequence: 1 },
        ],
        totalDistanceKm: routeResult.totalDistanceKm,
        totalDurationMin: routeResult.totalDurationMin,
        geometry: routeResult.geometry,
        legs: routeResult.legs,
      });
    }

    // Multiple stops: use OSRM trip solver for optimal order
    const tripResult = await getOptimalTrip(coords);

    // Map waypoint order back to addresses
    // waypointOrder[i] = index in the trip sequence for input point i
    // We need to reorder the stops (excluding start which stays first)
    const optimizedAddresses: Array<{
      address: string; lat: number; lng: number; displayName: string;
      type: "start" | "stop"; sequence: number;
    }> = [
      { ...validGeocoded[0], type: "start", sequence: 0 },
    ];

    // Build ordered list from trip waypoints
    // The trip returns waypoints in their trip order via waypoint_index
    const stopIndices = tripResult.waypointOrder.slice(1); // exclude start (index 0)

    // Create a mapping: trip position -> original index
    // waypointOrder gives us for each input waypoint, its position in the trip
    // We need to sort input indices (1..n) by their trip position
    const stopsWithOrder = addresses.map((_, i) => ({
      originalIndex: i + 1, // index in validGeocoded (0 is start)
      tripPosition: tripResult.waypointOrder[i + 1],
    }));
    stopsWithOrder.sort((a, b) => a.tripPosition - b.tripPosition);

    for (let seq = 0; seq < stopsWithOrder.length; seq++) {
      const { originalIndex } = stopsWithOrder[seq];
      optimizedAddresses.push({
        ...validGeocoded[originalIndex],
        type: "stop",
        sequence: seq + 1,
      });
    }

    // Get actual route geometry in the optimized order
    const optimizedCoords: [number, number][] = optimizedAddresses.map((a) => [a.lng, a.lat]);
    const routeResult = await getRoute(optimizedCoords);

    return NextResponse.json({
      optimizedAddresses,
      totalDistanceKm: routeResult.totalDistanceKm,
      totalDurationMin: routeResult.totalDurationMin,
      geometry: routeResult.geometry,
      legs: routeResult.legs,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Помилка оптимізації";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
