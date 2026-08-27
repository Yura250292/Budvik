"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FRAMED_MAP_OPTIONS, MapFrame, attachWheelGate, useMapExpand, useWheelGate } from "./MapFrame";

export interface GeoPoint {
  lat: number;
  lng: number;
  label?: string;
  address?: string;
  sequence?: number;
  type?: "start" | "stop";
  /** Зовнішній ключ точки — потрібен лише для дій у попапі (onRemoveStop) */
  id?: string;
}

interface DeliveryMapProps {
  stops: GeoPoint[];
  routeGeometry?: GeoJSON.LineString | null;
  height?: string;
  onMapClick?: (lat: number, lng: number) => void;
  pickingMode?: boolean; // show crosshair cursor when picking location
  /** Дія «прибрати точку» в попапі піна. Показується лише для точок з id. */
  onRemoveStop?: (id: string) => void;
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

export default function DeliveryMap({ stops, routeGeometry, height = "500px", onMapClick, pickingMode, onRemoveStop }: DeliveryMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  // Реф, а не залежність ефекту: інакше кожен новий колбек перемальовував
  // би всі маркери.
  const onRemoveStopRef = useRef(onRemoveStop);
  onRemoveStopRef.current = onRemoveStop;
  const hasRemove = !!onRemoveStop;
  const { wheelActive, onWheelChange } = useWheelGate();
  const { expanded, toggle } = useMapExpand(mapInstanceRef);

  useEffect(() => {
    if (!mapRef.current) return;

    // Initialize map only once
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = L.map(mapRef.current, FRAMED_MAP_OPTIONS).setView(
        [49.2328, 28.4816],
        12
      ); // Default: Vinnytsia

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(mapInstanceRef.current);

      attachWheelGate(mapInstanceRef.current, onWheelChange);

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
      // Попап збираємо DOM-вузлами, а не рядком: назви клієнтів приходять
      // з 1С як довільний текст, і кнопці потрібен справжній обробник.
      const popupEl = document.createElement("div");
      popupEl.style.cssText = "font-family:system-ui;font-size:13px;min-width:160px;";
      const strong = document.createElement("strong");
      strong.textContent = label;
      popupEl.appendChild(strong);
      if (stop.address) {
        const addr = document.createElement("div");
        addr.style.cssText = "color:#6B7280;margin-top:2px;";
        addr.textContent = stop.address;
        popupEl.appendChild(addr);
      }
      if (!isStart && stop.id && hasRemove) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Прибрати з маршруту";
        btn.style.cssText =
          "margin-top:8px;display:block;width:100%;padding:6px 10px;border-radius:6px;" +
          "border:1px solid #FCA5A5;background:#fff;color:#B91C1C;font-size:12px;" +
          "font-weight:600;cursor:pointer;";
        const stopId = stop.id;
        btn.onclick = () => onRemoveStopRef.current?.(stopId);
        popupEl.appendChild(btn);
      }
      marker.bindPopup(popupEl);

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
    // onWheelChange стабільний — див. useWheelGate.
  }, [stops, routeGeometry, onWheelChange, hasRemove]);

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
    // Під час вибору точки підказку не показуємо: там уже свій режим кліку,
    // і два повідомлення про клік поспіль тільки збивають.
    <MapFrame
      height={height}
      wheelActive={wheelActive}
      hint={!pickingMode}
      rounded="14px"
      expanded={expanded}
      onToggleExpand={toggle}
    >
      <div ref={mapRef} style={{ height: "100%", width: "100%" }} />
    </MapFrame>
  );
}
