"use client";

/**
 * Оглядова мапа напрямків: багато маршрутів одночасно, кожен своїм кольором.
 *
 * Окремо від RouteDayMap, бо там два шари з різним сенсом (план проти факту)
 * для одного торгового на один день, а тут N рівноправних маршрутів, які треба
 * розрізняти за кольором відповідального. Шари тримаємо в одній LayerGroup:
 * при десятках полілінь обхід усіх шарів мапи з instanceof — надто крихкий.
 */

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type OverviewStop = {
  settlement: string;
  displayName?: string | null;
  lat: number;
  lng: number;
  seq: number;
};

export type OverviewRoute = {
  /** Унікальний ключ шару: templateId або `${repId}:${templateId}` */
  id: string;
  name: string;
  color: string;
  /** GeoJSON LineString від OSRM; якщо немає — з'єднуємо пункти пунктиром */
  geometry?: { type: string; coordinates: [number, number][] } | null;
  stops: OverviewStop[];
  /** Пояснення в попапі: торговий, дні тижня */
  subtitle?: string | null;
};

export type LegendEntry = { label: string; color: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stopPin(seq: number, color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
    html: `<div style="
      width:26px;height:26px;border-radius:6px;
      background:${color};color:#FFFFFF;
      display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:11px;
      border:2px solid white;
      box-shadow:0 2px 8px rgba(0,0,0,0.25);
      font-family:system-ui,sans-serif;
    ">${seq}</div>`,
  });
}

export default function RoutesOverviewMap({
  routes,
  legend = [],
  height = "460px",
}: {
  routes: OverviewRoute[];
  legend?: LegendEntry[];
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);

  // Ключ змісту: інакше ефект перемальовував би мапу на кожен рендер вкладки,
  // навіть коли масив той самий за значенням.
  const routesKey = useMemo(
    () => routes.map((r) => `${r.id}:${r.color}:${r.stops.length}`).join("|"),
    [routes]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([49.8397, 24.0297], 8); // Львів — типовий центр напрямків

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(mapRef.current);

      layersRef.current = L.layerGroup().addTo(mapRef.current);
    }

    const map = mapRef.current;
    const group = layersRef.current;
    if (!group) return;

    group.clearLayers();

    const bounds = L.latLngBounds([]);

    routes.forEach((route) => {
      const popup = (stop: OverviewStop, index: number) =>
        `<div style="font-family:system-ui;font-size:13px;min-width:180px">
          <strong>${escapeHtml(stop.settlement)}</strong><br/>
          <span style="color:${route.color};font-weight:600">${escapeHtml(route.name)}</span>
          <span style="color:#6B7280"> · пункт №${index + 1}</span>
          ${route.subtitle ? `<br/><span style="color:#6B7280">${escapeHtml(route.subtitle)}</span>` : ""}
          ${stop.displayName ? `<br/><span style="color:#9CA3AF;font-size:11px">${escapeHtml(stop.displayName)}</span>` : ""}
        </div>`;

      if (route.geometry?.coordinates?.length) {
        // GeoJSON — [lng, lat], Leaflet чекає [lat, lng]
        const line = route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
        L.polyline(line, { color: route.color, weight: 5, opacity: 0.55 })
          .bindTooltip(route.subtitle ? `${route.name} · ${route.subtitle}` : route.name, { sticky: true })
          .addTo(group);
        line.forEach((c) => bounds.extend(c));
      } else if (route.stops.length >= 2) {
        const line = route.stops.map((s) => [s.lat, s.lng] as [number, number]);
        L.polyline(line, { color: route.color, weight: 4, opacity: 0.5, dashArray: "8 6" })
          .bindTooltip(route.subtitle ? `${route.name} · ${route.subtitle}` : route.name, { sticky: true })
          .addTo(group);
      }

      route.stops.forEach((stop, i) => {
        L.marker([stop.lat, stop.lng], { icon: stopPin(i + 1, route.color) })
          .bindPopup(popup(stop, i))
          .addTo(group);
        bounds.extend([stop.lat, stop.lng]);
      });
    });

    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    // routes навмисно не в залежностях — перемальовуємо за змістовим ключем
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesKey]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  return (
    <div className="relative" style={{ height, width: "100%" }}>
      <div ref={containerRef} style={{ height: "100%", width: "100%", borderRadius: "12px", overflow: "hidden" }} />
      {legend.length > 0 && (
        <div className="absolute right-2 top-2 z-[1000] max-h-[200px] max-w-[220px] overflow-y-auto rounded-[var(--radius-card)] bg-white/95 px-2.5 py-2 shadow-lg backdrop-blur">
          <ul className="space-y-1">
            {legend.map((item) => (
              <li key={`${item.label}-${item.color}`} className="flex items-center gap-1.5 text-xs text-bk">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: item.color }}
                />
                <span className="truncate">{item.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
