"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface ShiftPoint {
  lat: number;
  lng: number;
  /** "open" — відкриття зміни (зелений), "close" — закриття (червоний) */
  type: "open" | "close";
  workerName: string;
  time: string;
  address?: string | null;
  /** Пов'язана точка тієї ж зміни — щоб намалювати лінію відкриття → закриття */
  shiftId: string;
}

interface ShiftMapProps {
  points: ShiftPoint[];
  height?: string;
}

function createPin(type: "open" | "close"): L.DivIcon {
  const bg = type === "open" ? "#16A34A" : "#DC2626";
  const glyph = type === "open" ? "▶" : "■";

  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:${bg};color:white;
      display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:11px;
      border:3px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
      font-family:system-ui,sans-serif;
    ">${glyph}</div>`,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function ShiftMap({ points, height = "420px" }: ShiftMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([49.2328, 28.4816], 12); // За замовчуванням — Вінниця

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(mapInstanceRef.current);
    }

    const map = mapInstanceRef.current;

    map.eachLayer((layer) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline) {
        map.removeLayer(layer);
      }
    });

    if (points.length === 0) return;

    const bounds = L.latLngBounds([]);

    points.forEach((p) => {
      const marker = L.marker([p.lat, p.lng], { icon: createPin(p.type) }).addTo(map);
      const title = p.type === "open" ? "Відкриття зміни" : "Закриття зміни";

      marker.bindPopup(
        `<div style="font-family:system-ui;font-size:13px;min-width:180px">
          <strong>${escapeHtml(p.workerName)}</strong><br/>
          <span style="color:${p.type === "open" ? "#16A34A" : "#DC2626"};font-weight:600">
            ${title}
          </span><br/>
          <span style="color:#6B7280">🕐 ${escapeHtml(p.time)}</span>
          ${p.address ? `<br/><span style="color:#6B7280">📍 ${escapeHtml(p.address)}</span>` : ""}
        </div>`
      );

      bounds.extend([p.lat, p.lng]);
    });

    // Пунктир між відкриттям і закриттям однієї зміни — видно, чи людина
    // закрила зміну там само, де відкрила
    const byShift = new Map<string, ShiftPoint[]>();
    points.forEach((p) => {
      const list = byShift.get(p.shiftId) || [];
      list.push(p);
      byShift.set(p.shiftId, list);
    });

    byShift.forEach((list) => {
      if (list.length < 2) return;
      const open = list.find((p) => p.type === "open");
      const close = list.find((p) => p.type === "close");
      if (!open || !close) return;
      // Однакові координати лінію не потребують
      if (open.lat === close.lat && open.lng === close.lng) return;

      L.polyline(
        [
          [open.lat, open.lng],
          [close.lat, close.lng],
        ],
        { color: "#6B7280", weight: 2, opacity: 0.6, dashArray: "6 6" }
      ).addTo(map);
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }, [points]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={mapRef}
      style={{ height, width: "100%", borderRadius: "12px", overflow: "hidden" }}
    />
  );
}
