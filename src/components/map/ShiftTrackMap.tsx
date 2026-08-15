"use client";

/**
 * Маршрут зміни на карті: робочий трек і те, що було після неї.
 *
 * Два кольори, а не один: синє — час, за який платять, червоне —
 * поїздки після закриття зміни. Злиті в одну лінію, вони давали б
 * хибне враження довгого робочого дня.
 */

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FRAMED_MAP_OPTIONS, MapFrame, attachWheelGate, useWheelGate } from "./MapFrame";

export default function ShiftTrackMap({
  shiftPath,
  afterShiftPath,
  height = "420px",
}: {
  shiftPath: Array<[number, number]>;
  afterShiftPath: Array<[number, number]>;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const { wheelActive, onWheelChange } = useWheelGate();

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, FRAMED_MAP_OPTIONS).setView([49.8397, 24.0297], 9);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);

    attachWheelGate(map, onWheelChange);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
  }, [onWheelChange]);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerRef.current;
    if (!map || !group) return;

    group.clearLayers();
    const bounds = L.latLngBounds([]);

    if (shiftPath.length > 1) {
      L.polyline(shiftPath, { color: "#2563EB", weight: 4, opacity: 0.85 }).addTo(group);
      shiftPath.forEach((c) => bounds.extend(c));

      // Початок і кінець робочої зміни — щоб було видно, з якого краю
      // читати лінію.
      L.circleMarker(shiftPath[0], {
        radius: 6, color: "#fff", weight: 2, fillColor: "#16A34A", fillOpacity: 1,
      })
        .bindTooltip("Початок зміни", { direction: "top" })
        .addTo(group);

      L.circleMarker(shiftPath[shiftPath.length - 1], {
        radius: 6, color: "#fff", weight: 2, fillColor: "#DC2626", fillOpacity: 1,
      })
        .bindTooltip("Кінець зміни", { direction: "top" })
        .addTo(group);
    }

    if (afterShiftPath.length > 1) {
      // Пунктир: це вже не робочий маршрут, і лінія має читатися інакше
      // навіть без легенди.
      L.polyline(afterShiftPath, {
        color: "#DC2626",
        weight: 3,
        opacity: 0.8,
        dashArray: "8 6",
      })
        .bindTooltip("Після закриття зміни", { sticky: true })
        .addTo(group);
      afterShiftPath.forEach((c) => bounds.extend(c));
    }

    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [shiftPath, afterShiftPath]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  return (
    <MapFrame height={height} wheelActive={wheelActive}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
    </MapFrame>
  );
}
