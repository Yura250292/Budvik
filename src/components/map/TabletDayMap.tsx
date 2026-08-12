"use client";

/**
 * Карта дня для планшета в машині.
 *
 * Три шари, кожен відповідає на своє питання: пройдений трек — «де я
 * був», точки маршруту — «куди мені треба», колір точки — «що я там уже
 * відмітив».
 *
 * Окремо від SalesClientsMap, бо задача інша: там клієнти за станом
 * продажів (сплячий, втрачений), тут точки за статусом візиту. Спільне —
 * розмір маркерів під палець і відсутність зайвого керування.
 */

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type TabletStop = {
  key: string;
  counterpartyId: string | null;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  geoSource: string | null;
  sequence: number;
  amount: number;
  debtAmount: number;
  visit: { status: string; money: string; collectedAmount: number | null } | null;
};

/** Кольори статусів: сірий — ще не був, зелений — приїхав, червоний — не потрапив. */
const STOP_COLOR = {
  PENDING: "#6B7280",
  DONE: "#16A34A",
  MISSED: "#DC2626",
} as const;

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusOf(s: TabletStop): keyof typeof STOP_COLOR {
  if (s.visit?.status === "DONE") return "DONE";
  if (s.visit?.status === "MISSED") return "MISSED";
  return "PENDING";
}

/**
 * Точки без уточненого піна стоять по центру міста і накладаються одна на
 * одну. Розводимо по спіралі — те саме роблять карти клієнтів, інакше
 * десяток магазинів одного містечка виглядає як одна мітка.
 */
function spread(points: TabletStop[]): Array<TabletStop & { lat: number; lng: number }> {
  const seen = new Map<string, number>();
  const out: Array<TabletStop & { lat: number; lng: number }> = [];

  for (const p of points) {
    if (p.lat == null || p.lng == null) continue;
    const key = `${p.lat.toFixed(4)}:${p.lng.toFixed(4)}`;
    const i = seen.get(key) ?? 0;
    seen.set(key, i + 1);
    if (i === 0) {
      out.push(p as TabletStop & { lat: number; lng: number });
      continue;
    }
    const angle = i * 2.399963;
    const off = 0.00028 * Math.sqrt(i);
    out.push({
      ...p,
      lat: p.lat + off * Math.sin(angle),
      lng: p.lng + (off * Math.cos(angle)) / Math.cos((p.lat * Math.PI) / 180),
    } as TabletStop & { lat: number; lng: number });
  }
  return out;
}

function popupHtml(s: TabletStop): string {
  const debt =
    s.debtAmount > 0
      ? `<div style="color:#DC2626;font-weight:600;margin-top:2px">Забрати ${escapeHtml(money.format(s.debtAmount))} грн</div>`
      : "";
  const collected =
    s.visit?.collectedAmount != null
      ? `<div style="color:#16A34A;font-weight:600;margin-top:2px">Забрано ${escapeHtml(money.format(s.visit.collectedAmount))} грн</div>`
      : "";
  const nav =
    s.lat != null && s.lng != null
      ? `<a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}"
           target="_blank" rel="noopener"
           style="display:block;margin-top:8px;padding:9px;text-align:center;
           background:#2563EB;color:#fff;border-radius:8px;text-decoration:none;
           font-weight:600;font-size:13px">Навігація</a>`
      : "";

  return `<div style="font-family:system-ui;font-size:14px;min-width:190px;max-width:260px">
    <strong style="font-size:15px">${escapeHtml(String(s.sequence))}. ${escapeHtml(s.name)}</strong>
    ${s.address ? `<div style="color:#6B7280;margin-top:2px">${escapeHtml(s.address)}</div>` : ""}
    ${s.amount > 0 ? `<div style="margin-top:2px">Замовлення ${escapeHtml(money.format(s.amount))} грн</div>` : ""}
    ${debt}
    ${collected}
    ${s.geoSource !== "MANUAL" ? `<div style="color:#D97706;font-size:12px;margin-top:3px">Точка приблизна</div>` : ""}
    ${nav}
  </div>`;
}

export default function TabletDayMap({
  stops,
  trail,
  me,
  height = "100%",
}: {
  stops: TabletStop[];
  /** Пройдений сьогодні шлях */
  trail: Array<[number, number]>;
  me?: { lat: number; lng: number } | null;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const stopsLayerRef = useRef<L.LayerGroup | null>(null);
  const trailRef = useRef<L.Polyline | null>(null);
  const meRef = useRef<L.CircleMarker | null>(null);
  const fittedRef = useRef(false);

  // Перемальовуємо точки лише коли змінився склад або статуси — трек
  // оновлюється щохвилини, і тягнути за собою маркери марно.
  const stopsKey = useMemo(
    () => stops.map((s) => `${s.key}:${statusOf(s)}`).join("|"),
    [stops]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, {
        zoomControl: false, // зумлять пальцями
        attributionControl: true,
      }).setView([49.8397, 24.0297], 9);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(mapRef.current);

      stopsLayerRef.current = L.layerGroup().addTo(mapRef.current);
    }

    const map = mapRef.current;
    const group = stopsLayerRef.current;
    if (!group) return;

    group.clearLayers();
    const bounds = L.latLngBounds([]);

    spread(stops).forEach((s) => {
      const color = STOP_COLOR[statusOf(s)];
      // Маркер — divIcon, а не circleMarker: номер точки має бути прямо
      // на кружечку, щоб порядок об'їзду читався без тапу по кожній.
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:26px;height:26px;border-radius:50%;
                   background:${color};border:2.5px solid #fff;
                   box-shadow:0 1px 4px rgba(0,0,0,.4);
                   color:#fff;font:700 12px/21px system-ui;text-align:center">
                   ${escapeHtml(String(s.sequence))}
                 </div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      })
        .bindPopup(popupHtml(s), { minWidth: 190 })
        .addTo(group);
      bounds.extend([s.lat, s.lng]);
    });

    if (!fittedRef.current && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      fittedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey]);

  // Трек окремим шаром: додається точка за точкою, без перемальовування
  // маркерів.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (trail.length < 2) return;

    if (trailRef.current) {
      trailRef.current.setLatLngs(trail);
    } else {
      trailRef.current = L.polyline(trail, {
        color: "#2563EB",
        weight: 4,
        opacity: 0.75,
      }).addTo(map);
    }
  }, [trail]);

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
        radius: 8,
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
      stopsLayerRef.current = null;
      trailRef.current = null;
      meRef.current = null;
    };
  }, []);

  return <div ref={containerRef} style={{ height, width: "100%" }} />;
}
