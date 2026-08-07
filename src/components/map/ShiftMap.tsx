"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type ShiftPointType = "open" | "close" | "checkpoint";

export interface ShiftPoint {
  lat: number;
  lng: number;
  /**
   * "open" — початок (зелений), "close" — кінець (червоний),
   * "checkpoint" — відмітка торгового у клієнта (синій, з номером).
   */
  type: ShiftPointType;
  workerName: string;
  time: string;
  address?: string | null;
  /** Пов'язана точка тієї ж зміни/поїздки — щоб намалювати лінію маршруту */
  shiftId: string;
  /** Порядковий номер точки в поїздці — показуємо всередині піна */
  seq?: number;
}

interface ShiftMapProps {
  points: ShiftPoint[];
  height?: string;
  /**
   * Малювати маршрут через усі точки поїздки (старт → чекпоінти → фініш).
   * За замовчуванням вимкнено — складські зміни з'єднуються пунктиром
   * напряму, як і раніше.
   */
  connectRoute?: boolean;
}

const PIN_COLORS: Record<ShiftPointType, string> = {
  open: "#16A34A",
  close: "#DC2626",
  checkpoint: "#2563EB",
};

const PIN_TITLES: Record<ShiftPointType, string> = {
  open: "Відкриття зміни",
  close: "Закриття зміни",
  checkpoint: "Точка візиту",
};

function createPin(type: ShiftPointType, seq?: number): L.DivIcon {
  const bg = PIN_COLORS[type];
  const glyph = type === "open" ? "▶" : type === "close" ? "■" : String(seq ?? "•");
  const size = type === "checkpoint" ? 24 : 28;

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default function ShiftMap({
  points,
  height = "420px",
  connectRoute = false,
}: ShiftMapProps) {
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
      const marker = L.marker([p.lat, p.lng], { icon: createPin(p.type, p.seq) }).addTo(map);
      const title =
        p.type === "checkpoint" && p.seq != null
          ? `Точка №${p.seq}`
          : PIN_TITLES[p.type];

      marker.bindPopup(
        `<div style="font-family:system-ui;font-size:13px;min-width:180px">
          <strong>${escapeHtml(p.workerName)}</strong><br/>
          <span style="color:${PIN_COLORS[p.type]};font-weight:600">
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

      if (connectRoute) {
        // Маршрут поїздки: старт → точки за порядком → фініш
        const ordered = [
          ...list.filter((p) => p.type === "open"),
          ...list
            .filter((p) => p.type === "checkpoint")
            .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
          ...list.filter((p) => p.type === "close"),
        ];
        if (ordered.length < 2) return;

        L.polyline(
          ordered.map((p) => [p.lat, p.lng] as [number, number]),
          { color: "#2563EB", weight: 3, opacity: 0.55 }
        ).addTo(map);
        return;
      }

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
  }, [points, connectRoute]);

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
