"use client";

/**
 * Карта одного клієнта з черги «Точки з треку»: нинішня (приблизна) точка
 * сірим кільцем і місця, де стояв торговий, мітками A, B, C.
 *
 * Одна на всю чергу, а не мінікарта на кожен рядок: десятки екземплярів
 * Leaflet з тайлами на одній сторінці підвішують вкладку.
 */

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FRAMED_MAP_OPTIONS, attachWheelGate } from "./MapFrame";
import { candidatePin } from "./candidate-pin";

export type QueueMark = { label: string; lat: number; lng: number; title: string };

export default function PinQueueMap({
  current,
  marks,
  active,
  onPick,
}: {
  current: { lat: number; lng: number } | null;
  marks: QueueMark[];
  active: string | null;
  onPick: (label: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, FRAMED_MAP_OPTIONS).setView([49.8397, 24.0297], 8);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    attachWheelGate(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // У розробці React монтує двічі — шар, створений на мертвій карті, не видно.
    if (!layerRef.current || !map.hasLayer(layerRef.current)) layerRef.current = L.layerGroup().addTo(map);
    const layer = layerRef.current;
    layer.clearLayers();

    const b = L.latLngBounds([]);
    if (current) {
      L.circleMarker([current.lat, current.lng], {
        radius: 9,
        color: "#64748B",
        weight: 2,
        fillColor: "#fff",
        fillOpacity: 0.9,
      })
        .bindTooltip("Нинішня точка (приблизна)", { direction: "top" })
        .addTo(layer);
      b.extend([current.lat, current.lng]);
    }
    for (const m of marks) {
      L.marker([m.lat, m.lng], { icon: candidatePin(m.label, m.label === active), zIndexOffset: 1000 })
        .bindTooltip(m.title, { direction: "top" })
        .on("click", () => pickRef.current(m.label))
        .addTo(layer);
      b.extend([m.lat, m.lng]);
    }
    if (b.isValid()) map.fitBounds(b.pad(0.35), { maxZoom: 17 });
  }, [current, marks, active]);

  return (
    <div className="relative isolate overflow-hidden rounded-[12px] border border-line" style={{ height: "clamp(280px, 48vh, 440px)" }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
