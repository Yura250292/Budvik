"use client";

/**
 * Карта керівника: де зараз усі й де ходив вибраний.
 *
 * Два режими в одному компоненті, бо перехід між ними — це один клік і
 * жодного перезавантаження карти: доки ніхто не вибраний, показуємо
 * маркери всіх; щойно вибрали — домальовуємо трек дня і точки маршруту,
 * решта людей блякнуть.
 */

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FRAMED_MAP_OPTIONS, MapFrame, attachWheelGate, useWheelGate } from "./MapFrame";

export type TrackPerson = {
  userId: string;
  name: string;
  role: string;
  color: string | null;
  lat: number;
  lng: number;
  speedKmh: number | null;
  minutesAgo: number;
  online: boolean;
  distanceKm: number;
};

export type TrackDetail = {
  points: Array<{ lat: number; lng: number; recordedAt: string; speedKmh: number | null }>;
  stops: Array<{
    key: string;
    name: string;
    lat: number | null;
    lng: number | null;
    sequence: number;
    visit: { status: string } | null;
  }>;
};

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Колір людини: свій, якщо заданий, інакше за станом (онлайн/офлайн). */
function personColor(p: TrackPerson): string {
  if (p.color) return p.color;
  return p.online ? "#2563EB" : "#9CA3AF";
}

export default function TrackDayMap({
  people,
  selectedId,
  detail,
  onSelect,
  height = "460px",
}: {
  people: TrackPerson[];
  selectedId: string | null;
  detail: TrackDetail | null;
  onSelect: (id: string) => void;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const peopleLayerRef = useRef<L.LayerGroup | null>(null);
  const detailLayerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);
  const { wheelActive, onWheelChange } = useWheelGate();
  // Колбек у ref: інакше кожен новий рендер батька перемальовував би
  // маркери лише через те, що onSelect — нова функція.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const peopleKey = useMemo(
    () => people.map((p) => `${p.userId}:${p.lat.toFixed(4)}:${p.lng.toFixed(4)}:${p.online}`).join("|"),
    [people]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, FRAMED_MAP_OPTIONS).setView(
        [49.8397, 24.0297],
        9
      );
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(mapRef.current);
      attachWheelGate(mapRef.current, onWheelChange);
      peopleLayerRef.current = L.layerGroup().addTo(mapRef.current);
      detailLayerRef.current = L.layerGroup().addTo(mapRef.current);
    }

    const map = mapRef.current;
    const group = peopleLayerRef.current;
    if (!group) return;

    group.clearLayers();
    const bounds = L.latLngBounds([]);

    people.forEach((p) => {
      const dimmed = selectedId !== null && selectedId !== p.userId;
      const color = personColor(p);
      L.marker([p.lat, p.lng], {
        opacity: dimmed ? 0.45 : 1,
        icon: L.divIcon({
          className: "",
          html: `<div style="display:flex;align-items:center;gap:5px;
                   transform:translate(-11px,-11px);opacity:${dimmed ? 0.45 : 1}">
                   <span style="width:22px;height:22px;border-radius:50%;
                     background:${color};border:2.5px solid #fff;
                     box-shadow:0 1px 4px rgba(0,0,0,.4);flex:none"></span>
                   <span style="background:#fff;border-radius:6px;padding:1px 6px;
                     font:600 12px system-ui;white-space:nowrap;
                     box-shadow:0 1px 3px rgba(0,0,0,.25)">
                     ${escapeHtml(p.name)}
                   </span>
                 </div>`,
          iconSize: [0, 0],
        }),
      })
        .bindPopup(
          `<div style="font-family:system-ui;font-size:14px;min-width:170px">
            <strong>${escapeHtml(p.name)}</strong><br/>
            <span style="color:#6B7280">${p.online ? "На маршруті" : `${p.minutesAgo} хв тому`}</span><br/>
            <span style="color:#6B7280">Пробіг ${p.distanceKm} км</span>
            ${p.speedKmh != null ? `<br/><span style="color:#6B7280">${p.speedKmh} км/год</span>` : ""}
          </div>`
        )
        .on("click", () => onSelectRef.current(p.userId))
        .addTo(group);
      bounds.extend([p.lat, p.lng]);
    });

    if (!fittedRef.current && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
      fittedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peopleKey, selectedId]);

  // Деталі вибраного: трек і точки маршруту.
  useEffect(() => {
    const map = mapRef.current;
    const group = detailLayerRef.current;
    if (!map || !group) return;

    group.clearLayers();
    if (!detail) return;

    const bounds = L.latLngBounds([]);

    if (detail.points.length > 1) {
      const line = detail.points.map((p) => [p.lat, p.lng] as [number, number]);
      L.polyline(line, { color: "#2563EB", weight: 4, opacity: 0.8 }).addTo(group);
      line.forEach((c) => bounds.extend(c));

      // Початок дня окремим маркером: без нього неясно, з якого кінця
      // читати лінію.
      L.circleMarker(line[0], {
        radius: 6,
        color: "#fff",
        weight: 2,
        fillColor: "#16A34A",
        fillOpacity: 1,
      })
        .bindTooltip("Початок", { direction: "top" })
        .addTo(group);
    }

    detail.stops.forEach((s) => {
      if (s.lat == null || s.lng == null) return;
      const color =
        s.visit?.status === "DONE" ? "#16A34A" : s.visit?.status === "MISSED" ? "#DC2626" : "#6B7280";
      L.circleMarker([s.lat, s.lng], {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
      })
        .bindTooltip(`${s.sequence}. ${s.name}`, { direction: "top" })
        .addTo(group);
      bounds.extend([s.lat, s.lng]);
    });

    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [detail]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      peopleLayerRef.current = null;
      detailLayerRef.current = null;
    };
  }, []);

  return (
    <MapFrame height={height} wheelActive={wheelActive}>
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
    </MapFrame>
  );
}
