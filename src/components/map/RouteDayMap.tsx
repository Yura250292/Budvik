"use client";

/**
 * Мапа дня торгового: план проти факту.
 *
 * Окремо від ShiftMap, бо там усі точки рівноправні, а тут два шари з різним
 * сенсом: запланований напрямок (шаблон із розкладу) і те, де торговий
 * реально відмічався. Змішати їх в один список означало б втратити саме те
 * порівняння, заради якого мапа й потрібна.
 */

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type PlannedStop = {
  settlement: string;
  displayName?: string | null;
  lat: number;
  lng: number;
  seq: number;
};

export type ActualPoint = {
  lat: number;
  lng: number;
  type: "start" | "checkpoint" | "end";
  label: string;
  time?: string | null;
  address?: string | null;
  seq?: number;
};

const ACTUAL_COLORS = { start: "#16A34A", checkpoint: "#2563EB", end: "#DC2626" } as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plannedPin(seq: number, color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
    html: `<div style="
      width:26px;height:26px;border-radius:6px;
      background:${color};color:#0A0A0A;
      display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:11px;
      border:2px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.25);
      font-family:system-ui,sans-serif;
    ">${seq}</div>`,
  });
}

function actualPin(type: ActualPoint["type"], seq?: number): L.DivIcon {
  const bg = ACTUAL_COLORS[type];
  const glyph = type === "start" ? "▶" : type === "end" ? "■" : String(seq ?? "•");
  const size = type === "checkpoint" ? 22 : 26;

  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${bg};color:white;
      display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:${type === "checkpoint" ? 10 : 11}px;
      border:3px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
      font-family:system-ui,sans-serif;
    ">${glyph}</div>`,
  });
}

export default function RouteDayMap({
  plannedStops = [],
  plannedGeometry = null,
  plannedColor = "#FFB800",
  actual = [],
  height = "460px",
}: {
  plannedStops?: PlannedStop[];
  /** GeoJSON LineString від OSRM; якщо немає — з'єднуємо пункти прямою */
  plannedGeometry?: { type: string; coordinates: [number, number][] } | null;
  plannedColor?: string;
  actual?: ActualPoint[];
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([49.8397, 24.0297], 9); // Львів — типовий центр напрямків

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(mapRef.current);
    }

    const map = mapRef.current;
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline) map.removeLayer(layer);
    });

    const bounds = L.latLngBounds([]);

    // --- Плановий шар ---
    if (plannedGeometry?.coordinates?.length) {
      // GeoJSON — [lng, lat], Leaflet чекає [lat, lng]
      const line = plannedGeometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
      L.polyline(line, { color: plannedColor, weight: 5, opacity: 0.5 }).addTo(map);
      line.forEach((c) => bounds.extend(c));
    } else if (plannedStops.length >= 2) {
      L.polyline(
        plannedStops.map((s) => [s.lat, s.lng] as [number, number]),
        { color: plannedColor, weight: 4, opacity: 0.45, dashArray: "8 6" }
      ).addTo(map);
    }

    plannedStops.forEach((stop, i) => {
      L.marker([stop.lat, stop.lng], { icon: plannedPin(i + 1, plannedColor) })
        .addTo(map)
        .bindPopup(
          `<div style="font-family:system-ui;font-size:13px;min-width:170px">
            <strong>${escapeHtml(stop.settlement)}</strong><br/>
            <span style="color:#6B7280">За планом, пункт №${i + 1}</span>
            ${stop.displayName ? `<br/><span style="color:#9CA3AF;font-size:11px">${escapeHtml(stop.displayName)}</span>` : ""}
          </div>`
        );
      bounds.extend([stop.lat, stop.lng]);
    });

    // --- Фактичний шар ---
    const route = actual
      .filter((p) => p.type !== "end")
      .concat(actual.filter((p) => p.type === "end"));

    if (route.length >= 2) {
      L.polyline(
        route.map((p) => [p.lat, p.lng] as [number, number]),
        { color: "#2563EB", weight: 3, opacity: 0.7 }
      ).addTo(map);
    }

    actual.forEach((point) => {
      L.marker([point.lat, point.lng], { icon: actualPin(point.type, point.seq) })
        .addTo(map)
        .bindPopup(
          `<div style="font-family:system-ui;font-size:13px;min-width:180px">
            <strong>${escapeHtml(point.label)}</strong><br/>
            <span style="color:${ACTUAL_COLORS[point.type]};font-weight:600">Факт</span>
            ${point.time ? `<br/><span style="color:#6B7280">${escapeHtml(point.time)}</span>` : ""}
            ${point.address ? `<br/><span style="color:#6B7280">${escapeHtml(point.address)}</span>` : ""}
          </div>`
        );
      bounds.extend([point.lat, point.lng]);
    });

    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [plannedStops, plannedGeometry, plannedColor, actual]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={{ height, width: "100%", borderRadius: "12px", overflow: "hidden" }} />;
}
