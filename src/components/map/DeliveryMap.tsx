"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface GeoPoint {
  lat: number;
  lng: number;
  label?: string;
  address?: string;
  sequence?: number;
  type?: "start" | "stop";
}

interface DeliveryMapProps {
  stops: GeoPoint[];
  routeGeometry?: GeoJSON.LineString | null;
  height?: string;
  onMapClick?: (lat: number, lng: number) => void;
  pickingMode?: boolean; // show crosshair cursor when picking location
}

function createNumberedIcon(num: number, isStart: boolean): L.DivIcon {
  const bg = isStart ? "#0A0A0A" : "#FFD600";
  const color = isStart ? "#FFD600" : "#0A0A0A";
  const size = isStart ? 36 : 30;

  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${bg};color:${color};
      display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:${isStart ? 14 : 13}px;
      border:3px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
      font-family:system-ui,sans-serif;
    ">${isStart ? "⚑" : num}</div>`,
  });
}

export default function DeliveryMap({ stops, routeGeometry, height = "500px", onMapClick, pickingMode }: DeliveryMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  useEffect(() => {
    if (!mapRef.current) return;

    // Initialize map only once
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([49.2328, 28.4816], 12); // Default: Vinnytsia

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(mapInstanceRef.current);

      // Map click handler
      mapInstanceRef.current.on("click", (e: L.LeafletMouseEvent) => {
        if (onMapClickRef.current) {
          onMapClickRef.current(e.latlng.lat, e.latlng.lng);
        }
      });
    }

    const map = mapInstanceRef.current;

    // Clear existing layers (markers, polylines)
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline || layer instanceof L.GeoJSON) {
        map.removeLayer(layer);
      }
    });

    if (stops.length === 0) return;

    // Add markers
    const bounds = L.latLngBounds([]);
    stops.forEach((stop) => {
      const isStart = stop.type === "start";
      const seq = stop.sequence ?? 0;
      const icon = createNumberedIcon(seq, isStart);

      const marker = L.marker([stop.lat, stop.lng], { icon }).addTo(map);

      const label = stop.label || (isStart ? "Старт" : `Зупинка ${seq}`);
      const popup = `<div style="font-family:system-ui;font-size:13px;">
        <strong>${label}</strong>
        ${stop.address ? `<br/><span style="color:#6B7280">${stop.address}</span>` : ""}
      </div>`;
      marker.bindPopup(popup);

      bounds.extend([stop.lat, stop.lng]);
    });

    // Draw route polyline
    if (routeGeometry && routeGeometry.coordinates.length > 0) {
      const latlngs = routeGeometry.coordinates.map(
        (c: number[]) => [c[1], c[0]] as [number, number]
      );
      L.polyline(latlngs, {
        color: "#6366F1",
        weight: 5,
        opacity: 0.8,
        smoothFactor: 1,
      }).addTo(map);
    }

    // Fit bounds
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [stops, routeGeometry]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update cursor when picking mode changes
  useEffect(() => {
    const container = mapInstanceRef.current?.getContainer();
    if (container) {
      container.style.cursor = pickingMode ? "crosshair" : "";
    }
  }, [pickingMode]);

  return (
    <div
      ref={mapRef}
      style={{
        height,
        width: "100%",
        borderRadius: "14px",
        overflow: "hidden",
      }}
    />
  );
}
