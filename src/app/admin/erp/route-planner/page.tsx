"use client";

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import DynamicDeliveryMap from "@/components/map/DynamicMap";
import type { GeoPoint } from "@/components/map/DeliveryMap";

interface AddressEntry {
  id: string;
  address: string;
  geocoded?: { lat: number; lng: number; displayName: string };
  geocoding?: boolean;
  error?: string;
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

export default function RoutePlannerPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;

  const [startAddress, setStartAddress] = useState("Вінниця, склад");
  const [startGeo, setStartGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [pickingStart, setPickingStart] = useState(false);
  const [reverseGeocoding, setReverseGeocoding] = useState(false);
  const [newAddress, setNewAddress] = useState("");
  const [addresses, setAddresses] = useState<AddressEntry[]>([]);
  const [optimizing, setOptimizing] = useState(false);
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Map points for display
  const [mapStops, setMapStops] = useState<GeoPoint[]>([]);
  const [routeGeometry, setRouteGeometry] = useState<GeoJSON.LineString | null>(null);

  const geocodeAddress = useCallback(async (address: string): Promise<{ lat: number; lng: number; displayName: string } | null> => {
    try {
      const res = await fetch(`/api/geo/geocode?q=${encodeURIComponent(address)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  // Geocode start address and show on map
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

  // Handle map click — set start point via reverse geocode
  const handleMapClick = useCallback(async (lat: number, lng: number) => {
    if (!pickingStart) return;
    setPickingStart(false);
    setReverseGeocoding(true);

    try {
      const res = await fetch(`/api/geo/geocode?lat=${lat}&lng=${lng}`);
      if (res.ok) {
        const data = await res.json();
        setStartAddress(data.shortName || data.displayName);
        setStartGeo({ lat, lng });
        setMapStops((prev) => {
          const withoutStart = prev.filter((s) => s.type !== "start");
          return [{ lat, lng, label: "Старт (склад)", address: data.displayName, type: "start" as const, sequence: 0 }, ...withoutStart];
        });
        setResult(null);
        setRouteGeometry(null);
      }
    } catch { /* ignore */ }
    setReverseGeocoding(false);
  }, [pickingStart]);

  const addAddress = useCallback(async () => {
    const addr = newAddress.trim();
    if (!addr) return;

    const id = crypto.randomUUID();
    const entry: AddressEntry = { id, address: addr, geocoding: true };
    setAddresses((prev) => [...prev, entry]);
    setNewAddress("");
    setResult(null);
    setRouteGeometry(null);

    // Geocode in background
    const geo = await geocodeAddress(addr);
    setAddresses((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              geocoding: false,
              geocoded: geo || undefined,
              error: geo ? undefined : "Не знайдено. Спробуйте: Місто, вулиця, номер",
            }
          : a
      )
    );

    // Update map markers
    if (geo) {
      setMapStops((prev) => [...prev, { lat: geo.lat, lng: geo.lng, label: addr, address: geo.displayName, type: "stop", sequence: prev.filter((p) => p.type === "stop").length + 1 }]);
    }
  }, [newAddress, geocodeAddress]);

  const removeAddress = useCallback((id: string) => {
    setAddresses((prev) => {
      const removed = prev.find((a) => a.id === id);
      const updated = prev.filter((a) => a.id !== id);
      // Rebuild map stops
      if (removed?.geocoded) {
        setMapStops((stops) => {
          const filtered = stops.filter((s) => !(s.lat === removed.geocoded!.lat && s.lng === removed.geocoded!.lng && s.type === "stop"));
          return filtered.map((s, i) => s.type === "stop" ? { ...s, sequence: i + 1 } : s);
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
    if (validAddresses.length < 1) {
      setError("Додайте хоча б 1 адресу доставки");
      return;
    }
    if (!startAddress.trim()) {
      setError("Вкажіть початкову адресу");
      return;
    }

    setOptimizing(true);
    setError(null);

    try {
      const res = await fetch("/api/geo/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startAddress: startAddress.trim(),
          addresses: validAddresses.map((a) => a.address),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Помилка оптимізації");
        setOptimizing(false);
        return;
      }

      setResult(data);
      setRouteGeometry(data.geometry);

      // Update map stops in optimized order
      const newStops: GeoPoint[] = data.optimizedAddresses.map((a: OptimizeResult["optimizedAddresses"][0]) => ({
        lat: a.lat,
        lng: a.lng,
        label: a.type === "start" ? "Старт" : `${a.sequence}. ${a.address}`,
        address: a.displayName,
        type: a.type,
        sequence: a.sequence,
      }));
      setMapStops(newStops);

      // Reorder addresses list to match optimization
      const optimizedOrder = data.optimizedAddresses
        .filter((a: OptimizeResult["optimizedAddresses"][0]) => a.type === "stop")
        .map((a: OptimizeResult["optimizedAddresses"][0]) => a.address);

      setAddresses((prev) => {
        const reordered: AddressEntry[] = [];
        for (const addr of optimizedOrder) {
          const found = prev.find((p) => p.address === addr);
          if (found) reordered.push(found);
        }
        // Add any remaining (failed geocoding)
        for (const p of prev) {
          if (!reordered.find((r) => r.id === p.id)) reordered.push(p);
        }
        return reordered;
      });
    } catch {
      setError("Мережева помилка");
    }
    setOptimizing(false);
  }, [addresses, startAddress]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addAddress();
    }
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
            <Link href="/admin/erp/delivery-routes" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
              <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Планувальник маршрутів</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Введіть адреси — AI оптимізує маршрут</p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left panel: address input */}
          <div className="space-y-4">
            {/* Start address */}
            <div className="bg-white rounded-xl p-5" style={{ border: pickingStart ? "2px solid #FFD600" : "1px solid #EFEFEF", boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }}>
              <label style={{ fontSize: "13px", fontWeight: 600, color: "#6B7280", display: "block", marginBottom: "6px" }}>
                Початкова точка (склад)
              </label>
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
                  title="Знайти на карті"
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
                  onClick={() => setPickingStart(!pickingStart)}
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
                {reverseGeocoding && (
                  <span style={{ fontSize: "12px", color: "#9CA3AF" }}>Визначаю адресу...</span>
                )}
                {startGeo && !reverseGeocoding && (
                  <span style={{ fontSize: "11px", color: "#16A34A" }}>
                    {startGeo.lat.toFixed(4)}, {startGeo.lng.toFixed(4)}
                  </span>
                )}
              </div>
            </div>

            {/* Add address */}
            <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #EFEFEF", boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }}>
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
                        <p style={{ fontSize: "11px", color: "#DC2626" }}>{entry.error}</p>
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

            {/* Result summary */}
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
                      {idx > 0 && result.legs[idx - 1] && (
                        <span style={{ color: "#6B7280", fontSize: "12px", flexShrink: 0 }}>
                          {result.legs[idx - 1].distanceKm} км · {result.legs[idx - 1].durationMin} хв
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right panel: map */}
          <div className="lg:sticky lg:top-[80px] lg:self-start">
            {pickingStart && (
              <div style={{
                padding: "8px 16px", borderRadius: "8px 8px 0 0", fontSize: "13px", fontWeight: 600,
                background: "#FFD600", color: "#0A0A0A", textAlign: "center",
              }}>
                Натисніть на карту щоб вказати початкову точку
              </div>
            )}
            <DynamicDeliveryMap
              stops={mapStops}
              routeGeometry={routeGeometry}
              height="calc(100vh - 120px)"
              onMapClick={handleMapClick}
              pickingMode={pickingStart}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
