"use client";

import { useState, useCallback, useEffect, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import DynamicDeliveryMap from "@/components/map/DynamicMap";
import type { GeoPoint } from "@/components/map/DeliveryMap";

interface AddressEntry {
  id: string;
  address: string;
  geocoded?: { lat: number; lng: number; displayName: string };
  manualCoords?: { lat: number; lng: number };
  geocoding?: boolean;
  error?: string;
}

type VehicleType = "fuel" | "electric";

interface VehicleSettings {
  type: VehicleType;
  consumption: number;
  pricePerUnit: number;
}

interface OptimizeResult {
  optimizedAddresses: Array<{
    address: string;
    lat: number;
    lng: number;
    displayName: string;
    type: "start" | "stop";
    sequence: number;
  }>;
  totalDistanceKm: number;
  totalDurationMin: number;
  geometry: GeoJSON.LineString;
  legs: Array<{ distanceKm: number; durationMin: number }>;
}

interface Warehouse {
  id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
}

interface SavedRouteData {
  id: string;
  name: string;
  startAddress: string;
  startLat: number;
  startLng: number;
  vehicleType: string;
  consumption: number;
  pricePerUnit: number;
  totalDistanceKm: number | null;
  totalDurationMin: number | null;
  totalFuelCost: number | null;
  routeGeometry: GeoJSON.LineString | null;
  updatedAt: string;
  stops: Array<{ address: string; displayName: string | null; lat: number; lng: number; sequence: number }>;
}

function RoutePlannerContent() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const deliveryRouteId = searchParams.get("deliveryRouteId");
  const role = (session?.user as any)?.role;

  const [startAddress, setStartAddress] = useState("Вінниця, склад");
  const [startGeo, setStartGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [pickingStart, setPickingStart] = useState(false);
  const [pickingStopId, setPickingStopId] = useState<string | null>(null);
  const [pickingNewStop, setPickingNewStop] = useState(false);
  const [reverseGeocoding, setReverseGeocoding] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [addresses, setAddresses] = useState<AddressEntry[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Vehicle & fuel
  const [vehicle, setVehicle] = useState<VehicleSettings>({
    type: "fuel", consumption: 10, pricePerUnit: 56,
  });
  const [manualDistance, setManualDistance] = useState<number | null>(null);
  const [fuelBuffer, setFuelBuffer] = useState(0); // % надбавка до палива (корки, холодний двигун тощо)

  // Map
  const [mapStops, setMapStops] = useState<GeoPoint[]>([]);
  const [routeGeometry, setRouteGeometry] = useState<GeoJSON.LineString | null>(null);

  // Warehouses
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [showWarehouseForm, setShowWarehouseForm] = useState(false);
  const [newWarehouse, setNewWarehouse] = useState({ name: "", address: "" });
  const [savingWarehouse, setSavingWarehouse] = useState(false);

  // Saved routes
  const [savedRoutes, setSavedRoutes] = useState<SavedRouteData[]>([]);
  const [showSavedRoutes, setShowSavedRoutes] = useState(false);
  const [savingRoute, setSavingRoute] = useState(false);
  const [routeName, setRouteName] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [activeRouteId, setActiveRouteId] = useState<string | null>(null);

  // Delivery route sync
  const [linkedDeliveryRoute, setLinkedDeliveryRoute] = useState<any>(null);
  const [savingToDelivery, setSavingToDelivery] = useState(false);

  // Share
  const [copiedLink, setCopiedLink] = useState(false);

  const isPicking = pickingStart || !!pickingStopId || pickingNewStop;

  // Load warehouses & saved routes on mount
  useEffect(() => {
    fetch("/api/geo/warehouses").then((r) => r.ok ? r.json() : []).then(setWarehouses).catch(() => {});
    fetch("/api/geo/saved-routes").then((r) => r.ok ? r.json() : []).then(setSavedRoutes).catch(() => {});
  }, []);

  // Load delivery route stops if deliveryRouteId param given
  useEffect(() => {
    if (!deliveryRouteId || !session) return;
    fetch(`/api/erp/delivery-routes/${deliveryRouteId}`)
      .then((r) => r.json())
      .then(async (route) => {
        setLinkedDeliveryRoute(route);
        if (!route.stops?.length) return;

        // Geocode each stop's deliveryAddress / address
        const newAddresses: AddressEntry[] = [];
        for (const stop of route.stops) {
          const addr = stop.counterparty?.deliveryAddress || stop.counterparty?.address || stop.address || "";
          if (!addr) continue;
          const entry: AddressEntry = { id: crypto.randomUUID(), address: addr };
          // Try saved coords first
          if (stop.counterparty?.deliveryLat && stop.counterparty?.deliveryLng) {
            entry.geocoded = {
              lat: stop.counterparty.deliveryLat,
              lng: stop.counterparty.deliveryLng,
              displayName: stop.counterparty.name || addr,
            };
          } else {
            entry.geocoding = true;
          }
          newAddresses.push(entry);
        }
        setAddresses(newAddresses);

        // Geocode missing ones
        const updated = [...newAddresses];
        for (let i = 0; i < updated.length; i++) {
          if (!updated[i].geocoded && updated[i].address) {
            updated[i] = { ...updated[i], geocoding: true };
            setAddresses([...updated]);
            try {
              const res = await fetch(`/api/geo/geocode?q=${encodeURIComponent(updated[i].address)}`);
              if (res.ok) {
                const geo = await res.json();
                updated[i] = { ...updated[i], geocoded: geo, geocoding: false };
              } else {
                updated[i] = { ...updated[i], geocoding: false, error: "Не знайдено" };
              }
            } catch {
              updated[i] = { ...updated[i], geocoding: false, error: "Помилка" };
            }
            setAddresses([...updated]);
          }
        }

        // Rebuild map stops
        const mapPts: GeoPoint[] = updated
          .filter((a) => a.geocoded)
          .map((a, idx) => ({
            lat: a.geocoded!.lat, lng: a.geocoded!.lng,
            label: `${idx + 1}. ${a.address}`,
            address: a.geocoded!.displayName,
            type: "stop" as const,
            sequence: idx + 1,
          }));
        setMapStops(mapPts);
      })
      .catch(() => {});
  }, [deliveryRouteId, session]); // eslint-disable-line react-hooks/exhaustive-deps

  const geocodeAddress = useCallback(async (address: string): Promise<{ lat: number; lng: number; displayName: string } | null> => {
    try {
      const res = await fetch(`/api/geo/geocode?q=${encodeURIComponent(address)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  const geocodeStart = useCallback(async (address: string) => {
    const geo = await geocodeAddress(address);
    if (geo) {
      setStartGeo({ lat: geo.lat, lng: geo.lng });
      setMapStops((prev) => {
        const withoutStart = prev.filter((s) => s.type !== "start");
        return [{ lat: geo.lat, lng: geo.lng, label: "Старт (склад)", address: geo.displayName, type: "start" as const, sequence: 0 }, ...withoutStart];
      });
    }
  }, [geocodeAddress]);

  // Select warehouse as start point
  const selectWarehouse = useCallback((wh: Warehouse) => {
    setStartAddress(wh.address || wh.name);
    if (wh.lat && wh.lng) {
      setStartGeo({ lat: wh.lat, lng: wh.lng });
      setMapStops((prev) => {
        const withoutStart = prev.filter((s) => s.type !== "start");
        return [{ lat: wh.lat!, lng: wh.lng!, label: `Старт (${wh.name})`, address: wh.address || wh.name, type: "start" as const, sequence: 0 }, ...withoutStart];
      });
    } else {
      setStartGeo(null);
    }
    setResult(null);
    setRouteGeometry(null);
  }, []);

  // Save new warehouse
  const handleSaveWarehouse = useCallback(async () => {
    if (!newWarehouse.name.trim()) return;
    setSavingWarehouse(true);
    try {
      const res = await fetch("/api/geo/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newWarehouse.name.trim(),
          address: newWarehouse.address.trim() || undefined,
          lat: startGeo?.lat,
          lng: startGeo?.lng,
        }),
      });
      if (res.ok) {
        const wh = await res.json();
        setWarehouses((prev) => [...prev, wh]);
        setNewWarehouse({ name: "", address: "" });
        setShowWarehouseForm(false);
      }
    } catch { /* ignore */ }
    setSavingWarehouse(false);
  }, [newWarehouse, startGeo]);

  // Handle map click
  const handleMapClick = useCallback(async (lat: number, lng: number) => {
    if (!pickingStart && !pickingStopId && !pickingNewStop) return;

    const isPickingStartNow = pickingStart;
    const stopIdNow = pickingStopId;
    const isNewStop = pickingNewStop;

    setPickingStart(false);
    setPickingStopId(null);
    setPickingNewStop(false);
    setReverseGeocoding(true);

    try {
      const res = await fetch(`/api/geo/geocode?lat=${lat}&lng=${lng}`);
      const data = res.ok ? await res.json() : null;
      const displayName = data?.shortName || data?.displayName || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

      if (isPickingStartNow) {
        setStartAddress(displayName);
        setStartGeo({ lat, lng });
        setMapStops((prev) => {
          const withoutStart = prev.filter((s) => s.type !== "start");
          return [{ lat, lng, label: "Старт (склад)", address: displayName, type: "start" as const, sequence: 0 }, ...withoutStart];
        });
      } else if (stopIdNow) {
        setAddresses((prev) =>
          prev.map((a) =>
            a.id === stopIdNow
              ? { ...a, geocoding: false, error: undefined, manualCoords: { lat, lng }, geocoded: { lat, lng, displayName } }
              : a
          )
        );
        setMapStops((prev) => {
          const existing = addresses.find((a) => a.id === stopIdNow);
          let filtered = prev;
          if (existing?.geocoded) {
            filtered = prev.filter((s) => !(s.lat === existing.geocoded!.lat && s.lng === existing.geocoded!.lng && s.type === "stop"));
          } else if (existing?.manualCoords) {
            filtered = prev.filter((s) => !(s.lat === existing.manualCoords!.lat && s.lng === existing.manualCoords!.lng && s.type === "stop"));
          }
          const stopCount = filtered.filter((s) => s.type === "stop").length;
          return [...filtered, { lat, lng, label: existing?.address || displayName, address: displayName, type: "stop" as const, sequence: stopCount + 1 }];
        });
      } else if (isNewStop) {
        const id = crypto.randomUUID();
        const entry: AddressEntry = { id, address: displayName, geocoded: { lat, lng, displayName }, manualCoords: { lat, lng } };
        setAddresses((prev) => [...prev, entry]);
        setMapStops((prev) => {
          const stopCount = prev.filter((s) => s.type === "stop").length;
          return [...prev, { lat, lng, label: displayName, address: displayName, type: "stop" as const, sequence: stopCount + 1 }];
        });
      }

      setResult(null);
      setRouteGeometry(null);
    } catch { /* ignore */ }
    setReverseGeocoding(false);
  }, [pickingStart, pickingStopId, pickingNewStop, addresses]);

  const addAddress = useCallback(async () => {
    const addr = newAddress.trim();
    if (!addr) return;
    const id = crypto.randomUUID();
    setAddresses((prev) => [...prev, { id, address: addr, geocoding: true }]);
    setNewAddress("");
    setResult(null);
    setRouteGeometry(null);

    const geo = await geocodeAddress(addr);
    setAddresses((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, geocoding: false, geocoded: geo || undefined, error: geo ? undefined : "Не знайдено. Спробуйте: Місто, вулиця, номер" }
          : a
      )
    );
    if (geo) {
      setMapStops((prev) => [...prev, { lat: geo.lat, lng: geo.lng, label: addr, address: geo.displayName, type: "stop", sequence: prev.filter((p) => p.type === "stop").length + 1 }]);
    }
  }, [newAddress, geocodeAddress]);

  const removeAddress = useCallback((id: string) => {
    setAddresses((prev) => {
      const removed = prev.find((a) => a.id === id);
      const updated = prev.filter((a) => a.id !== id);
      const coords = removed?.geocoded || removed?.manualCoords;
      if (coords) {
        setMapStops((stops) => {
          const filtered = stops.filter((s) => !(s.lat === coords.lat && s.lng === coords.lng && s.type === "stop"));
          let seq = 0;
          return filtered.map((s) => s.type === "stop" ? { ...s, sequence: ++seq } : s);
        });
      }
      return updated;
    });
    setResult(null);
    setRouteGeometry(null);
  }, []);

  const moveAddress = useCallback((index: number, direction: -1 | 1) => {
    setAddresses((prev) => {
      const newArr = [...prev];
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= newArr.length) return prev;
      [newArr[index], newArr[newIndex]] = [newArr[newIndex], newArr[index]];
      return newArr;
    });
    setResult(null);
    setRouteGeometry(null);
  }, []);

  const handleOptimize = useCallback(async () => {
    const validAddresses = addresses.filter((a) => a.geocoded && !a.error);
    if (validAddresses.length < 1) { setError("Додайте хоча б 1 адресу доставки"); return; }
    if (!startAddress.trim()) { setError("Вкажіть початкову адресу"); return; }

    setOptimizing(true);
    setError(null);

    try {
      const res = await fetch("/api/geo/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startAddress: startAddress.trim(),
          startCoords: startGeo,
          addresses: validAddresses.map((a) => a.address),
          addressCoords: validAddresses.map((a) => a.manualCoords || (a.geocoded ? { lat: a.geocoded.lat, lng: a.geocoded.lng } : null)),
        }),
      });

      const data = await res.json();
      if (!res.ok) { setError(data.error || "Помилка оптимізації"); setOptimizing(false); return; }

      setResult(data);
      setRouteGeometry(data.geometry);
      setManualDistance(null); // use optimized distance

      const newStops: GeoPoint[] = data.optimizedAddresses.map((a: OptimizeResult["optimizedAddresses"][0]) => ({
        lat: a.lat, lng: a.lng,
        label: a.type === "start" ? "Старт" : `${a.sequence}. ${a.address}`,
        address: a.displayName, type: a.type, sequence: a.sequence,
      }));
      setMapStops(newStops);

      const optimizedOrder = data.optimizedAddresses
        .filter((a: OptimizeResult["optimizedAddresses"][0]) => a.type === "stop")
        .map((a: OptimizeResult["optimizedAddresses"][0]) => a.address);

      setAddresses((prev) => {
        const reordered: AddressEntry[] = [];
        for (const addr of optimizedOrder) {
          const found = prev.find((p) => p.address === addr);
          if (found) reordered.push(found);
        }
        for (const p of prev) {
          if (!reordered.find((r) => r.id === p.id)) reordered.push(p);
        }
        return reordered;
      });
    } catch {
      setError("Мережева помилка");
    }
    setOptimizing(false);
  }, [addresses, startAddress, startGeo]);

  // Save route
  const handleSaveRoute = useCallback(async () => {
    if (!routeName.trim() || !startGeo) return;
    setSavingRoute(true);

    const validStops = addresses.filter((a) => a.geocoded).map((a, i) => ({
      address: a.address,
      displayName: a.geocoded!.displayName,
      lat: a.geocoded!.lat,
      lng: a.geocoded!.lng,
      sequence: i + 1,
    }));

    const fuelUsed = result ? (result.totalDistanceKm * vehicle.consumption) / 100 : null;
    const totalFuelCost = fuelUsed ? fuelUsed * vehicle.pricePerUnit : null;

    const payload = {
      name: routeName.trim(),
      startAddress,
      startLat: startGeo.lat,
      startLng: startGeo.lng,
      vehicleType: vehicle.type,
      consumption: vehicle.consumption,
      pricePerUnit: vehicle.pricePerUnit,
      totalDistanceKm: result?.totalDistanceKm,
      totalDurationMin: result?.totalDurationMin,
      totalFuelCost,
      routeGeometry: routeGeometry,
      stops: validStops,
    };

    try {
      const url = activeRouteId ? `/api/geo/saved-routes/${activeRouteId}` : "/api/geo/saved-routes";
      const method = activeRouteId ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

      if (res.ok) {
        const saved = await res.json();
        if (activeRouteId) {
          setSavedRoutes((prev) => prev.map((r) => r.id === saved.id ? saved : r));
        } else {
          setSavedRoutes((prev) => [saved, ...prev]);
        }
        setActiveRouteId(saved.id);
        setShowSaveDialog(false);
        setRouteName("");
      }
    } catch { /* ignore */ }
    setSavingRoute(false);
  }, [routeName, startAddress, startGeo, addresses, vehicle, result, routeGeometry, activeRouteId]);

  // Save optimized order back to the linked DeliveryRoute
  const handleSaveToDeliveryRoute = useCallback(async () => {
    if (!linkedDeliveryRoute || !result) return;
    setSavingToDelivery(true);
    try {
      // Map optimized addresses back to stop IDs by address matching
      const optimized = result.optimizedAddresses.filter((a) => a.type === "stop");
      const stops = linkedDeliveryRoute.stops as any[];

      const stopSequences = optimized.map((opt, idx) => {
        // find stop whose counterparty address matches
        const stop = stops.find((s: any) => {
          const addr = s.counterparty?.deliveryAddress || s.counterparty?.address || s.address || "";
          return addr.trim().toLowerCase() === opt.address.trim().toLowerCase();
        }) || stops[idx]; // fallback by index
        return {
          stopId: stop?.id,
          sequence: idx + 1,
          distanceKm: result.legs[idx]?.distanceKm,
        };
      }).filter((s) => s.stopId);

      const res = await fetch(`/api/erp/delivery-routes/${linkedDeliveryRoute.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stopSequences,
          totalDistanceKm: result.totalDistanceKm,
          totalFuelCost: result.totalDistanceKm * vehicle.consumption / 100 * vehicle.pricePerUnit,
        }),
      });
      if (res.ok) {
        alert(`Маршрут ${linkedDeliveryRoute.number} оновлено!\nПорядок зупинок та відстань збережено.`);
      } else {
        const d = await res.json();
        alert(d.error || "Помилка збереження");
      }
    } catch {
      alert("Мережева помилка");
    }
    setSavingToDelivery(false);
  }, [linkedDeliveryRoute, result, vehicle]);

  // Load saved route
  const loadRoute = useCallback((route: SavedRouteData) => {
    setActiveRouteId(route.id);
    setStartAddress(route.startAddress);
    setStartGeo({ lat: route.startLat, lng: route.startLng });
    setVehicle({
      type: (route.vehicleType as VehicleType) || "fuel",
      consumption: route.consumption,
      pricePerUnit: route.pricePerUnit,
    });

    const newAddresses: AddressEntry[] = route.stops.map((s) => ({
      id: crypto.randomUUID(),
      address: s.address,
      geocoded: { lat: s.lat, lng: s.lng, displayName: s.displayName || s.address },
      manualCoords: { lat: s.lat, lng: s.lng },
    }));
    setAddresses(newAddresses);

    // Rebuild map stops
    const stops: GeoPoint[] = [
      { lat: route.startLat, lng: route.startLng, label: `Старт (${route.startAddress})`, address: route.startAddress, type: "start" as const, sequence: 0 },
      ...route.stops.map((s) => ({
        lat: s.lat, lng: s.lng,
        label: `${s.sequence}. ${s.address}`,
        address: s.displayName || s.address,
        type: "stop" as const,
        sequence: s.sequence,
      })),
    ];
    setMapStops(stops);

    if (route.routeGeometry) {
      setRouteGeometry(route.routeGeometry);
    } else {
      setRouteGeometry(null);
    }

    // Restore result if available
    if (route.totalDistanceKm && route.totalDurationMin) {
      setResult(null); // Clear old result, user can re-optimize
    } else {
      setResult(null);
    }

    setShowSavedRoutes(false);
  }, []);

  // Delete saved route
  const deleteRoute = useCallback(async (id: string) => {
    try {
      await fetch(`/api/geo/saved-routes/${id}`, { method: "DELETE" });
      setSavedRoutes((prev) => prev.filter((r) => r.id !== id));
      if (activeRouteId === id) setActiveRouteId(null);
    } catch { /* ignore */ }
  }, [activeRouteId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); addAddress(); }
  };

  if (!["ADMIN", "MANAGER"].includes(role)) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Доступ заборонено</h1>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={linkedDeliveryRoute ? "/manager/routes" : "/admin/erp/delivery-routes"}
              className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
              <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Планувальник маршрутів</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>
                {linkedDeliveryRoute
                  ? `Маршрут ${linkedDeliveryRoute.number} · ${linkedDeliveryRoute.driver?.name || "без водія"} · ${linkedDeliveryRoute._count?.stops || 0} зупинок`
                  : "Введіть адреси — AI оптимізує маршрут"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Save to delivery route button */}
            {linkedDeliveryRoute && result && (
              <button
                onClick={handleSaveToDeliveryRoute}
                disabled={savingToDelivery}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "8px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 700,
                  background: "linear-gradient(135deg, #16A34A, #15803D)", color: "white", border: "none",
                  opacity: savingToDelivery ? 0.6 : 1,
                }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {savingToDelivery ? "Збереження..." : `Зберегти в ${linkedDeliveryRoute.number}`}
              </button>
            )}
            {/* Saved routes button */}
            <button
              onClick={() => setShowSavedRoutes(!showSavedRoutes)}
              style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "8px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                background: "#F9FAFB", color: "#374151", border: "1px solid #E5E7EB",
              }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
              Маршрути
            </button>
            {/* Save current route */}
            {addresses.length > 0 && startGeo && (
              <button
                onClick={() => {
                  if (activeRouteId) { setRouteName(""); handleSaveRoute(); }
                  else setShowSaveDialog(true);
                }}
                disabled={savingRoute}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "8px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                  background: activeRouteId ? "#F0FDF4" : "#FFD600",
                  color: activeRouteId ? "#16A34A" : "#0A0A0A",
                  border: activeRouteId ? "1px solid #BBF7D0" : "none",
                }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
                {savingRoute ? "..." : activeRouteId ? "Оновити" : "Зберегти"}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Save dialog modal */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowSaveDialog(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-sm mx-4" style={{ boxShadow: "0 8px 30px rgba(0,0,0,0.15)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "12px" }}>Зберегти маршрут</h3>
            <input
              value={routeName}
              onChange={(e) => setRouteName(e.target.value)}
              placeholder="Назва маршруту (напр: Вінниця-Хмельницький)"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveRoute(); }}
              style={{ width: "100%", padding: "10px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px", marginBottom: "12px" }}
            />
            <div className="flex gap-2">
              <button onClick={() => setShowSaveDialog(false)}
                style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px", fontWeight: 600, background: "white" }}>
                Скасувати
              </button>
              <button onClick={handleSaveRoute} disabled={!routeName.trim() || savingRoute}
                style={{
                  flex: 1, padding: "10px", borderRadius: "8px", border: "none", fontSize: "14px", fontWeight: 700,
                  background: routeName.trim() ? "#FFD600" : "#E5E7EB", color: routeName.trim() ? "#0A0A0A" : "#9CA3AF",
                }}>
                {savingRoute ? "Зберігаю..." : "Зберегти"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Saved routes panel */}
      {showSavedRoutes && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-20" style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setShowSavedRoutes(false)}>
          <div className="bg-white rounded-xl w-full max-w-lg mx-4 max-h-[70vh] overflow-auto" style={{ boxShadow: "0 8px 30px rgba(0,0,0,0.15)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white p-4 border-b border-gray-100 flex items-center justify-between">
              <h3 style={{ fontSize: "18px", fontWeight: 700 }}>Збережені маршрути</h3>
              <button onClick={() => setShowSavedRoutes(false)} style={{ fontSize: "20px", color: "#9CA3AF" }}>×</button>
            </div>
            {savedRoutes.length === 0 ? (
              <div className="p-8 text-center" style={{ color: "#9CA3AF", fontSize: "14px" }}>
                Немає збережених маршрутів
              </div>
            ) : (
              <div>
                {savedRoutes.map((route) => (
                  <div key={route.id} className="flex items-center gap-3 p-4 border-b border-gray-50 hover:bg-gray-50"
                    style={{ cursor: "pointer" }}
                    onClick={() => loadRoute(route)}>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>{route.name}</p>
                      <p style={{ fontSize: "12px", color: "#6B7280" }}>
                        {route.startAddress} → {route.stops.length} зупинок
                        {route.totalDistanceKm ? ` · ${route.totalDistanceKm} км` : ""}
                      </p>
                      <p style={{ fontSize: "11px", color: "#9CA3AF" }}>
                        {new Date(route.updatedAt).toLocaleDateString("uk-UA")}
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteRoute(route.id); }}
                      style={{ width: "28px", height: "28px", borderRadius: "6px", border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#DC2626", fontSize: "14px", flexShrink: 0 }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left panel */}
          <div className="space-y-4">
            {/* Start address + warehouse picker */}
            <div className="bg-white rounded-xl p-5" style={{ border: pickingStart ? "2px solid #FFD600" : "1px solid #EFEFEF", boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }}>
              <div className="flex items-center justify-between mb-2">
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>
                  Початкова точка (склад)
                </label>
                {activeRouteId && (
                  <span style={{ fontSize: "11px", color: "#16A34A", fontWeight: 600 }}>Збережено</span>
                )}
              </div>

              {/* Warehouse quick-select */}
              {warehouses.length > 0 && (
                <div className="flex gap-1.5 mb-3 flex-wrap">
                  {warehouses.map((wh) => (
                    <button key={wh.id} onClick={() => selectWarehouse(wh)}
                      style={{
                        padding: "4px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
                        background: startAddress === (wh.address || wh.name) ? "#0A0A0A" : "#F3F4F6",
                        color: startAddress === (wh.address || wh.name) ? "#FFD600" : "#374151",
                        border: "none",
                      }}>
                      {wh.name}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-2 items-center">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "#0A0A0A", color: "#FFD600", fontSize: "14px", fontWeight: 800 }}>
                  ⚑
                </div>
                <input
                  value={startAddress}
                  onChange={(e) => { setStartAddress(e.target.value); setStartGeo(null); setResult(null); setRouteGeometry(null); }}
                  placeholder="Вінниця, склад"
                  style={{ flex: 1, padding: "8px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                />
                <button
                  onClick={() => geocodeStart(startAddress)}
                  disabled={!startAddress.trim()}
                  style={{
                    padding: "8px 12px", borderRadius: "8px", fontWeight: 600, fontSize: "13px",
                    background: startGeo ? "#F0FDF4" : "#EFF6FF", color: startGeo ? "#16A34A" : "#2563EB",
                    border: `1px solid ${startGeo ? "#BBF7D0" : "#BFDBFE"}`, whiteSpace: "nowrap",
                  }}
                >
                  {startGeo ? "✓" : "Знайти"}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => { setPickingStart(!pickingStart); setPickingStopId(null); setPickingNewStop(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    padding: "7px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                    background: pickingStart ? "#FFD600" : "#F9FAFB",
                    color: pickingStart ? "#0A0A0A" : "#6B7280",
                    border: pickingStart ? "2px solid #0A0A0A" : "1px solid #E5E7EB",
                  }}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {pickingStart ? "Натисніть на карту..." : "Вказати на карті"}
                </button>
                {/* Save as warehouse */}
                {startGeo && !showWarehouseForm && (
                  <button onClick={() => setShowWarehouseForm(true)}
                    style={{ fontSize: "11px", fontWeight: 600, padding: "5px 10px", borderRadius: "6px", background: "#F3F4F6", color: "#6B7280", border: "none" }}>
                    + Зберегти як склад
                  </button>
                )}
                {reverseGeocoding && <span style={{ fontSize: "12px", color: "#9CA3AF" }}>Визначаю адресу...</span>}
                {startGeo && !reverseGeocoding && !showWarehouseForm && (
                  <span style={{ fontSize: "11px", color: "#16A34A" }}>{startGeo.lat.toFixed(4)}, {startGeo.lng.toFixed(4)}</span>
                )}
              </div>

              {/* Warehouse save form */}
              {showWarehouseForm && (
                <div className="mt-3 p-3 rounded-lg" style={{ background: "#F9FAFB", border: "1px solid #E5E7EB" }}>
                  <input
                    value={newWarehouse.name}
                    onChange={(e) => setNewWarehouse((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Назва складу"
                    autoFocus
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #E5E7EB", fontSize: "13px", marginBottom: "8px" }}
                  />
                  <div className="flex gap-2">
                    <button onClick={() => setShowWarehouseForm(false)}
                      style={{ padding: "6px 12px", borderRadius: "6px", fontSize: "12px", border: "1px solid #E5E7EB", background: "white" }}>
                      Скасувати
                    </button>
                    <button onClick={handleSaveWarehouse} disabled={!newWarehouse.name.trim() || savingWarehouse}
                      style={{
                        padding: "6px 12px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, border: "none",
                        background: newWarehouse.name.trim() ? "#FFD600" : "#E5E7EB",
                        color: newWarehouse.name.trim() ? "#0A0A0A" : "#9CA3AF",
                      }}>
                      {savingWarehouse ? "..." : "Зберегти"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Add address */}
            <div className="bg-white rounded-xl p-5" style={{ border: pickingNewStop ? "2px solid #FFD600" : "1px solid #EFEFEF", boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#6B7280", display: "block", marginBottom: "6px" }}>
                Додати адресу доставки
              </label>
              <div className="flex gap-2">
                <input
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Місто, вулиця, номер (напр: Вінниця, Соборна 25)"
                  style={{ flex: 1, padding: "10px 12px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                />
                <button
                  onClick={addAddress}
                  disabled={!newAddress.trim()}
                  style={{
                    padding: "10px 20px", borderRadius: "8px", fontWeight: 700, fontSize: "14px",
                    background: newAddress.trim() ? "#FFD600" : "#F3F4F6",
                    color: newAddress.trim() ? "#0A0A0A" : "#9CA3AF",
                    border: "none", whiteSpace: "nowrap",
                  }}
                >
                  Додати
                </button>
              </div>
              <button
                onClick={() => { setPickingNewStop(!pickingNewStop); setPickingStart(false); setPickingStopId(null); }}
                style={{
                  display: "flex", alignItems: "center", gap: "6px", marginTop: "8px",
                  padding: "7px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                  background: pickingNewStop ? "#FFD600" : "#F9FAFB",
                  color: pickingNewStop ? "#0A0A0A" : "#6B7280",
                  border: pickingNewStop ? "2px solid #0A0A0A" : "1px solid #E5E7EB",
                }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {pickingNewStop ? "Натисніть на карту..." : "Вказати точку на карті"}
              </button>
            </div>

            {/* Address list */}
            {addresses.length > 0 && (
              <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF", boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid #F3F4F6" }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>
                    Зупинки ({addresses.length})
                  </span>
                </div>
                {addresses.map((entry, idx) => (
                  <div key={entry.id} className="flex items-center gap-3" style={{
                    padding: "10px 16px", borderBottom: "1px solid #F9FAFB",
                    background: entry.error ? "#FEF2F2" : "white",
                  }}>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        background: entry.geocoding ? "#F3F4F6" : entry.error ? "#FEE2E2" : "#FFF9DB",
                        color: entry.error ? "#DC2626" : "#0A0A0A",
                        fontSize: "12px", fontWeight: 700,
                      }}>
                      {entry.geocoding ? "..." : entry.error ? "!" : idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: "14px", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {entry.address}
                      </p>
                      {entry.geocoded && (
                        <p style={{ fontSize: "11px", color: "#9CA3AF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {entry.geocoded.displayName}
                        </p>
                      )}
                      {entry.error && (
                        <div className="flex items-center gap-2">
                          <p style={{ fontSize: "11px", color: "#DC2626" }}>{entry.error}</p>
                          <button
                            onClick={() => { setPickingStopId(entry.id); setPickingStart(false); setPickingNewStop(false); }}
                            style={{
                              fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "4px",
                              background: pickingStopId === entry.id ? "#FFD600" : "#FEF3C7",
                              color: "#92400E", border: "none", whiteSpace: "nowrap", cursor: "pointer",
                            }}
                          >
                            {pickingStopId === entry.id ? "Вкажіть на карті..." : "На карті"}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => moveAddress(idx, -1)} disabled={idx === 0}
                        style={{ width: "28px", height: "28px", borderRadius: "6px", border: "1px solid #E5E7EB", background: "white", fontSize: "12px", opacity: idx === 0 ? 0.3 : 1, cursor: idx === 0 ? "default" : "pointer" }}>
                        ↑
                      </button>
                      <button onClick={() => moveAddress(idx, 1)} disabled={idx === addresses.length - 1}
                        style={{ width: "28px", height: "28px", borderRadius: "6px", border: "1px solid #E5E7EB", background: "white", fontSize: "12px", opacity: idx === addresses.length - 1 ? 0.3 : 1, cursor: idx === addresses.length - 1 ? "default" : "pointer" }}>
                        ↓
                      </button>
                      <button onClick={() => removeAddress(entry.id)}
                        style={{ width: "28px", height: "28px", borderRadius: "6px", border: "1px solid #FCA5A5", background: "#FEF2F2", color: "#DC2626", fontSize: "14px" }}>
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Vehicle & fuel settings */}
            {(() => {
              const distKm = manualDistance ?? result?.totalDistanceKm ?? 0;
              const bufferMultiplier = 1 + fuelBuffer / 100;
              const fuelBase = (distKm * vehicle.consumption) / 100;
              const fuelUsed = fuelBase * bufferMultiplier;
              const totalCost = fuelUsed * vehicle.pricePerUnit;
              return (
              <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF", boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }}>
                <label style={{ fontSize: "13px", fontWeight: 600, color: "#6B7280", display: "block", marginBottom: "8px" }}>
                  Транспорт та витрати
                </label>
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setVehicle((v) => ({ ...v, type: "fuel", consumption: 10, pricePerUnit: 56 }))}
                    style={{
                      flex: 1, padding: "8px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                      background: vehicle.type === "fuel" ? "#0A0A0A" : "#F9FAFB",
                      color: vehicle.type === "fuel" ? "#FFD600" : "#6B7280",
                      border: vehicle.type === "fuel" ? "none" : "1px solid #E5E7EB",
                    }}
                  >
                    Паливо
                  </button>
                  <button
                    onClick={() => setVehicle((v) => ({ ...v, type: "electric", consumption: 18, pricePerUnit: 7 }))}
                    style={{
                      flex: 1, padding: "8px 12px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                      background: vehicle.type === "electric" ? "#0A0A0A" : "#F9FAFB",
                      color: vehicle.type === "electric" ? "#34D399" : "#6B7280",
                      border: vehicle.type === "electric" ? "none" : "1px solid #E5E7EB",
                    }}
                  >
                    Електро
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label style={{ fontSize: "11px", color: "#9CA3AF", display: "block", marginBottom: "4px" }}>
                      Витрата ({vehicle.type === "fuel" ? "л" : "кВт·год"}/100км)
                    </label>
                    <input
                      type="number"
                      value={vehicle.consumption}
                      onChange={(e) => setVehicle((v) => ({ ...v, consumption: Math.max(0, parseFloat(e.target.value) || 0) }))}
                      style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: "11px", color: "#9CA3AF", display: "block", marginBottom: "4px" }}>
                      Ціна ({vehicle.type === "fuel" ? "грн/л" : "грн/кВт·год"})
                    </label>
                    <input
                      type="number"
                      value={vehicle.pricePerUnit}
                      onChange={(e) => setVehicle((v) => ({ ...v, pricePerUnit: Math.max(0, parseFloat(e.target.value) || 0) }))}
                      style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label style={{ fontSize: "11px", color: "#9CA3AF", display: "block", marginBottom: "4px" }}>
                      Відстань (км)
                    </label>
                    <input
                      type="number"
                      value={manualDistance ?? result?.totalDistanceKm ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setManualDistance(v === "" ? null : Math.max(0, parseFloat(v) || 0));
                      }}
                      placeholder={result?.totalDistanceKm?.toString() || "0"}
                      style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: "11px", color: "#9CA3AF", display: "block", marginBottom: "4px" }}>
                      Запас на корки / холод
                    </label>
                    <div className="flex gap-1">
                      {[0, 5, 10, 15, 20].map((pct) => (
                        <button key={pct} onClick={() => setFuelBuffer(pct)}
                          style={{
                            flex: 1, padding: "7px 0", borderRadius: "6px", fontSize: "12px", fontWeight: 700,
                            background: fuelBuffer === pct ? "#0A0A0A" : "#F3F4F6",
                            color: fuelBuffer === pct ? "#FFD600" : "#6B7280",
                            border: "none",
                          }}>
                          {pct === 0 ? "0" : `+${pct}%`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Live calculation */}
                {distKm > 0 && vehicle.consumption > 0 && (
                  <div className="grid grid-cols-3 gap-2" style={{ marginTop: "4px" }}>
                    <div style={{ padding: "10px 8px", borderRadius: "8px", background: "#F5F3FF", textAlign: "center" }}>
                      <p style={{ fontSize: "18px", fontWeight: 800, color: "#6366F1" }}>{distKm}</p>
                      <p style={{ fontSize: "10px", color: "#6B7280" }}>км</p>
                    </div>
                    <div style={{ padding: "10px 8px", borderRadius: "8px", background: vehicle.type === "fuel" ? "#FFF7ED" : "#ECFDF5", textAlign: "center" }}>
                      <p style={{ fontSize: "18px", fontWeight: 800, color: vehicle.type === "fuel" ? "#EA580C" : "#059669" }}>
                        {fuelUsed.toFixed(1)}
                      </p>
                      <p style={{ fontSize: "10px", color: "#6B7280" }}>
                        {vehicle.type === "fuel" ? "літрів" : "кВт·год"}
                        {fuelBuffer > 0 && <span style={{ color: "#F59E0B" }}> (+{fuelBuffer}%)</span>}
                      </p>
                    </div>
                    <div style={{ padding: "10px 8px", borderRadius: "8px", background: "#FEF9C3", textAlign: "center" }}>
                      <p style={{ fontSize: "18px", fontWeight: 800, color: "#A16207" }}>{totalCost.toFixed(0)}</p>
                      <p style={{ fontSize: "10px", color: "#6B7280" }}>грн</p>
                    </div>
                  </div>
                )}
              </div>
              );
            })()}

            {/* Optimize button */}
            {addresses.length >= 1 && (
              <button
                onClick={handleOptimize}
                disabled={optimizing || addresses.every((a) => !!a.error || a.geocoding)}
                style={{
                  width: "100%", padding: "14px", borderRadius: "12px", fontWeight: 700, fontSize: "16px",
                  background: optimizing ? "#E5E7EB" : "linear-gradient(135deg, #8B5CF6, #6366F1)",
                  color: optimizing ? "#9CA3AF" : "white", border: "none",
                  boxShadow: optimizing ? "none" : "0 4px 12px rgba(99,102,241,0.3)",
                }}
              >
                {optimizing ? "Оптимізую маршрут..." : "Оптимізувати маршрут"}
              </button>
            )}

            {/* Error */}
            {error && (
              <div style={{ padding: "12px 16px", borderRadius: "8px", background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#DC2626", fontSize: "14px" }}>
                {error}
              </div>
            )}

            {/* Result summary — optimized route details */}
            {result && (
              <div className="bg-white rounded-xl p-5" style={{ border: "2px solid #8B5CF6", boxShadow: "0 4px 12px rgba(139,92,246,0.1)" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "12px", color: "#0A0A0A" }}>
                  Оптимальний маршрут
                </h3>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div style={{ padding: "12px", borderRadius: "8px", background: "#F5F3FF", textAlign: "center" }}>
                    <p style={{ fontSize: "24px", fontWeight: 800, color: "#6366F1" }}>{result.totalDistanceKm}</p>
                    <p style={{ fontSize: "12px", color: "#6B7280" }}>км загалом</p>
                  </div>
                  <div style={{ padding: "12px", borderRadius: "8px", background: "#F5F3FF", textAlign: "center" }}>
                    <p style={{ fontSize: "24px", fontWeight: 800, color: "#6366F1" }}>
                      {result.totalDurationMin < 60
                        ? `${result.totalDurationMin} хв`
                        : `${Math.floor(result.totalDurationMin / 60)} год ${result.totalDurationMin % 60} хв`}
                    </p>
                    <p style={{ fontSize: "12px", color: "#6B7280" }}>в дорозі</p>
                  </div>
                </div>

                {/* Share: Google Maps + Waze */}
                {(() => {
                  const allPoints = result.optimizedAddresses;
                  const startPoint = allPoints.find((p) => p.type === "start");
                  const stops = allPoints.filter((p) => p.type === "stop");
                  const lastStop = stops[stops.length - 1];
                  const midStops = stops.slice(0, -1);

                  // Google Maps: origin=склад, destination=остання зупинка, waypoints=проміжні
                  const gmOrigin = startPoint ? `${startPoint.lat},${startPoint.lng}` : "";
                  const gmDest = lastStop ? `${lastStop.lat},${lastStop.lng}` : "";
                  const gmWaypoints = midStops.map((p) => `${p.lat},${p.lng}`).join("|");
                  const gmParams = new URLSearchParams({
                    api: "1",
                    origin: gmOrigin,
                    destination: gmDest,
                    travelmode: "driving",
                  });
                  if (gmWaypoints) gmParams.set("waypoints", gmWaypoints);
                  const googleMapsUrl = `https://www.google.com/maps/dir/?${gmParams.toString()}`;

                  // Waze: doesn't support multi-stop — open with all points as dir/ URL
                  // Waze deeplink navigates to a single point, so for multi-stop we build
                  // a Google Maps-style share and per-stop Waze links in the legs section
                  const wazeUrl = lastStop
                    ? `https://waze.com/ul?ll=${lastStop.lat},${lastStop.lng}&navigate=yes`
                    : null;

                  const handleCopyLink = async () => {
                    const text = [
                      `Маршрут: ${startPoint?.address || "Старт"} -> ${stops.length} зупинок`,
                      `${result.totalDistanceKm} км, ~${result.totalDurationMin < 60 ? `${result.totalDurationMin} хв` : `${Math.floor(result.totalDurationMin / 60)} год ${result.totalDurationMin % 60} хв`}`,
                      "",
                      "Google Maps (повний маршрут):",
                      googleMapsUrl,
                      "",
                      "Зупинки:",
                      ...stops.map((s, i) => `${i + 1}. ${s.address}`),
                    ].join("\n");
                    try {
                      await navigator.clipboard.writeText(text);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2000);
                    } catch { /* fallback: do nothing */ }
                  };

                  // Google Maps without warehouse (driver already loaded — start from first stop)
                  const gmNoWarehouseParams = stops.length >= 2
                    ? (() => {
                        const p = new URLSearchParams({
                          api: "1",
                          origin: `${stops[0].lat},${stops[0].lng}`,
                          destination: `${stops[stops.length - 1].lat},${stops[stops.length - 1].lng}`,
                          travelmode: "driving",
                        });
                        const wps = stops.slice(1, -1).map((s) => `${s.lat},${s.lng}`).join("|");
                        if (wps) p.set("waypoints", wps);
                        return p;
                      })()
                    : null;
                  const googleMapsNoWarehouseUrl = gmNoWarehouseParams
                    ? `https://www.google.com/maps/dir/?${gmNoWarehouseParams.toString()}`
                    : stops.length === 1
                      ? `https://www.google.com/maps/dir/?api=1&destination=${stops[0].lat},${stops[0].lng}&travelmode=driving`
                      : null;

                  return (
                    <div className="space-y-2 mb-4">
                      {/* Main navigation row */}
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={googleMapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: "inline-flex", alignItems: "center", gap: "6px",
                            padding: "8px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                            background: "#EEF2FF", color: "#4338CA", border: "1px solid #C7D2FE",
                            textDecoration: "none",
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" fill="#4338CA"/>
                          </svg>
                          Google Maps
                        </a>
                        {googleMapsNoWarehouseUrl && (
                          <a
                            href={googleMapsNoWarehouseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Маршрут без складу — водій вже завантажений"
                            style={{
                              display: "inline-flex", alignItems: "center", gap: "6px",
                              padding: "8px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                              background: "#FFF7ED", color: "#C2410C", border: "1px solid #FED7AA",
                              textDecoration: "none",
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z" fill="#C2410C"/>
                            </svg>
                            Без складу
                          </a>
                        )}
                        <button
                          onClick={handleCopyLink}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: "6px",
                            padding: "8px 14px", borderRadius: "8px", fontSize: "13px", fontWeight: 600,
                            background: copiedLink ? "#F0FDF4" : "#F9FAFB",
                            color: copiedLink ? "#16A34A" : "#374151",
                            border: copiedLink ? "1px solid #BBF7D0" : "1px solid #E5E7EB",
                            cursor: "pointer",
                          }}
                        >
                          {copiedLink ? (
                            <>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              Скопійовано!
                            </>
                          ) : (
                            <>
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                              </svg>
                              Поділитись
                            </>
                          )}
                        </button>
                      </div>
                      <p style={{ fontSize: "11px", color: "#9CA3AF" }}>
                        &laquo;Без складу&raquo; — маршрут тільки по зупинках (водій вже завантажений)
                      </p>
                    </div>
                  );
                })()}

                {/* Legs details */}
                <div className="space-y-2">
                  {result.optimizedAddresses.map((addr, idx) => (
                    <div key={idx} className="flex items-center gap-2" style={{ fontSize: "13px" }}>
                      <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{
                          background: addr.type === "start" ? "#0A0A0A" : "#FFD600",
                          color: addr.type === "start" ? "#FFD600" : "#0A0A0A",
                          fontSize: "10px", fontWeight: 800,
                        }}>
                        {addr.type === "start" ? "⚑" : addr.sequence}
                      </div>
                      <span className="flex-1 truncate" style={{ color: "#374151" }}>{addr.address}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {idx > 0 && result.legs[idx - 1] && (
                          <span style={{ color: "#6B7280", fontSize: "12px" }}>
                            {result.legs[idx - 1].distanceKm} км · {result.legs[idx - 1].durationMin} хв
                          </span>
                        )}
                        {addr.type === "stop" && (
                          <a
                            href={`https://waze.com/ul?ll=${addr.lat},${addr.lng}&navigate=yes`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`Навігація Waze: ${addr.address}`}
                            style={{
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              width: "22px", height: "22px", borderRadius: "5px",
                              background: "#F0FDF4", border: "1px solid #BBF7D0",
                              textDecoration: "none", flexShrink: 0,
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                              <path d="M20.54 6.63A8.97 8.97 0 0012.05 3C7.05 3 3 7.05 3 12.05c0 2.8 1.28 5.3 3.29 6.95H6.3c-.02 1.1.88 2 1.98 2h.02c1.1 0 2-0.9 2-2h3.4c0 1.1.9 2 2 2s2-.9 2-2c2.37-1.62 3.3-4.03 3.3-6.58 0-2.07-.7-3.97-1.86-5.47l-.6-.32zM9 13c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z" fill="#15803D"/>
                            </svg>
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right panel: map */}
          <div className="lg:sticky lg:top-[80px] lg:self-start">
            <div style={{
              background: "white",
              borderRadius: "16px",
              border: isPicking ? "2px solid #FFD600" : "1px solid #EFEFEF",
              boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
              overflow: "hidden",
            }}>
              {isPicking && (
                <div style={{
                  padding: "8px 16px", fontSize: "13px", fontWeight: 600,
                  background: "#FFD600", color: "#0A0A0A", textAlign: "center",
                }}>
                  {pickingStart ? "Натисніть на карту щоб вказати початкову точку" :
                   pickingStopId ? "Натисніть на карту щоб вказати зупинку" :
                   "Натисніть на карту щоб додати нову зупинку"}
                </div>
              )}
              <DynamicDeliveryMap
                stops={mapStops}
                routeGeometry={routeGeometry}
                height="min(60vh, 500px)"
                onMapClick={handleMapClick}
                pickingMode={isPicking}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RoutePlannerPage() {
  return (
    <Suspense>
      <RoutePlannerContent />
    </Suspense>
  );
}
