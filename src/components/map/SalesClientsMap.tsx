"use client";

/**
 * Карта клієнтів торгового: хто поруч, до кого сьогодні, хто вже мовчить.
 *
 * Окремо від адмінського ClientMap: там фільтри, легенда-чекбокси, режими
 * додавання точок і перенесення пінів — усе під мишу й великий екран. Тут
 * телефон у машині: тап по точці одразу веде в картку клієнта, зайвого
 * керування немає, а маркери більші, бо в них цілять пальцем.
 */

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CLIENT_STATE } from "@/lib/analytics/colors";

/** Що торговий може зробити з точки, крім переходу в картку. */
export type SalesMapAction = { kind: "orderCard"; id: string };

export type SalesClientPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  state: keyof typeof CLIENT_STATE;
  address: string | null;
  receivable: number;
  overdue: number;
  daysSinceLast: number | null;
  approximate: boolean;
};

export type SalesRoute = {
  name: string;
  color: string | null;
  totalDistanceKm: number | null;
  geometry: { type: string; coordinates: [number, number][] } | null;
  stops: Array<{ settlement: string; lat: number; lng: number; seq: number }>;
} | null;

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/** Розводить точки, що впали в одні координати (геокод до міста). */
function spread<T extends { lat: number; lng: number }>(points: T[]): T[] {
  const seen = new Map<string, number>();
  return points.map((p) => {
    const key = `${p.lat.toFixed(4)}:${p.lng.toFixed(4)}`;
    const i = seen.get(key) ?? 0;
    seen.set(key, i + 1);
    if (i === 0) return p;
    const angle = i * 2.399963;
    const off = 0.00028 * Math.sqrt(i);
    return {
      ...p,
      lat: p.lat + off * Math.sin(angle),
      lng: p.lng + (off * Math.cos(angle)) / Math.cos((p.lat * Math.PI) / 180),
    };
  });
}

function popupHtml(c: SalesClientPoint): string {
  const meta = CLIENT_STATE[c.state];
  const debt =
    c.overdue > 0
      ? `<div style="color:#DC2626;font-weight:600">Прострочено ${escapeHtml(money.format(c.overdue))} грн</div>`
      : c.receivable > 0
        ? `<div style="color:#6B7280">Борг ${escapeHtml(money.format(c.receivable))} грн</div>`
        : "";

  return `<div style="font-family:system-ui;font-size:14px;min-width:190px;max-width:250px">
    <strong style="font-size:15px">${escapeHtml(c.name)}</strong><br/>
    <span style="display:inline-block;margin:5px 0;padding:2px 8px;border-radius:10px;
      background:${meta.color};color:#fff;font-size:11px;font-weight:700">
      ${escapeHtml(meta.label)}
    </span>
    ${c.daysSinceLast != null ? `<div style="color:#6B7280">Останній документ ${c.daysSinceLast} дн. тому</div>` : ""}
    ${debt}
    ${c.approximate ? `<div style="color:#D97706;font-size:12px;margin-top:3px">Точка приблизна</div>` : ""}
    <button data-action="orderCard" data-id="${escapeHtml(c.id)}"
       style="display:block;width:100%;margin-top:8px;padding:9px;text-align:center;
       background:#0A0A0A;color:#fff;border:none;border-radius:8px;
       font-weight:600;font-size:13px;cursor:pointer">Що брав і що везти</button>
    <a href="/sales/clients/${escapeHtml(c.id)}"
       style="display:block;margin-top:6px;padding:8px;text-align:center;
       background:#fff;color:#0A0A0A;border:1px solid #E5E7EB;border-radius:8px;
       text-decoration:none;font-weight:600;font-size:13px">Відкрити картку</a>
  </div>`;
}

export default function SalesClientsMap({
  clients,
  route,
  me,
  onAction,
  height = "100%",
}: {
  clients: SalesClientPoint[];
  route: SalesRoute;
  /** Де зараз торговий — щоб бачити, хто поряд. */
  me?: { lat: number; lng: number } | null;
  onAction?: (action: SalesMapAction) => void;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const meRef = useRef<L.CircleMarker | null>(null);
  const fittedRef = useRef(false);
  /** Колбек у ref: інакше кожен новий рендер сторінки перемальовував би точки. */
  const actionRef = useRef(onAction);
  actionRef.current = onAction;

  const key = useMemo(
    () =>
      clients.map((c) => `${c.id}:${c.state}`).join("|") +
      "#" +
      (route?.name ?? "") +
      (route?.stops.length ?? 0),
    [clients, route]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, {
        zoomControl: false, // на телефоні зумлять пальцями
        attributionControl: true,
      }).setView([49.8397, 24.0297], 9);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(mapRef.current);

      layersRef.current = L.layerGroup().addTo(mapRef.current);

      // Попапи — рядки HTML, тож React-обробник на кнопку не почепиш:
      // ловимо тап делегуванням на відкритому попапі (як в адмінській карті).
      mapRef.current.on("popupopen", (e: L.PopupEvent) => {
        const root = e.popup.getElement();
        root?.querySelectorAll<HTMLElement>("[data-action]").forEach((btn) => {
          btn.onclick = () => {
            const kind = btn.dataset.action as SalesMapAction["kind"];
            const id = btn.dataset.id;
            if (!kind || !id) return;
            mapRef.current?.closePopup();
            actionRef.current?.({ kind, id });
          };
        });
      });
    }

    const map = mapRef.current;
    const group = layersRef.current;
    if (!group) return;

    group.clearLayers();
    const bounds = L.latLngBounds([]);

    // Маршрут — під точками: він фон, а не головне.
    if (route?.geometry?.coordinates?.length) {
      const line = route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
      L.polyline(line, { color: route.color ?? "#2a78d6", weight: 4, opacity: 0.5 }).addTo(group);
      line.forEach((c) => bounds.extend(c));
    }
    route?.stops.forEach((s) => {
      L.circleMarker([s.lat, s.lng], {
        radius: 5,
        color: route.color ?? "#2a78d6",
        weight: 2,
        fillColor: "#fff",
        fillOpacity: 1,
      })
        .bindTooltip(s.settlement, { direction: "top" })
        .addTo(group);
      bounds.extend([s.lat, s.lng]);
    });

    spread(clients).forEach((c) => {
      L.circleMarker([c.lat, c.lng], {
        radius: 9, // більше за адмінські 7: ціль для пальця
        color: "#fff",
        weight: 2,
        fillColor: CLIENT_STATE[c.state].color,
        fillOpacity: 0.92,
      })
        .bindPopup(popupHtml(c), { minWidth: 190 })
        .addTo(group);
      bounds.extend([c.lat, c.lng]);
    });

    if (!fittedRef.current && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
      fittedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Своя позиція окремим шаром: оновлюється частіше за точки клієнтів.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!me) {
      meRef.current?.remove();
      meRef.current = null;
      return;
    }
    if (meRef.current) {
      meRef.current.setLatLng([me.lat, me.lng]);
    } else {
      meRef.current = L.circleMarker([me.lat, me.lng], {
        radius: 7,
        color: "#fff",
        weight: 3,
        fillColor: "#2563EB",
        fillOpacity: 1,
      })
        .bindTooltip("Ви тут", { direction: "top" })
        .addTo(map);
    }
  }, [me]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current = null;
      meRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={{ height, width: "100%" }} />;
}
