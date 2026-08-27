"use client";

/**
 * Маршрут зміни на карті: робочий трек, те, що було після неї, і план.
 *
 * Три сенси, три кольори. Синє — час, за який платять. Червоний пунктир —
 * поїздки після закриття зміни. Зелене — маршрут, який торговому
 * призначили: він лежить ПІД треком, бо це підкладка-лінійка, а не факт.
 * Злиті в одну лінію, вони давали б хибне враження довгого робочого дня.
 *
 * Червоні кола — епізоди, коли трек надовго пішов за межі коридору
 * маршруту. Коло, а не маркер: епізод — це область і тривалість.
 */

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FRAMED_MAP_OPTIONS, MapFrame, attachWheelGate, useWheelGate } from "./MapFrame";

/** Пункт призначеного маршруту. */
/**
 * Колір замовлення. Фіолетовий навмисно: синій зайнятий треком, червоний —
 * відхиленнями й треком після зміни, зелений — планом.
 */
const ORDER_COLOR = "#7C3AED";

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

export type PlanStop = {
  settlement: string;
  displayName?: string | null;
  lat: number;
  lng: number;
};

/** Епізод виходу за коридор — час уже відформатований сервером. */
export type PlanExcursion = {
  fromTime: string;
  toTime: string;
  minutes: number;
  km: number;
  maxDistanceM: number;
  lat: number;
  lng: number;
};

const PLAN_COLOR = "#16A34A";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Квадратна нумерована мітка пункту плану — щоб не плуталася з круглими точками треку. */
function planPin(seq: number): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
    html: `<div style="
      width:24px;height:24px;border-radius:6px;
      background:${PLAN_COLOR};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:11px;
      border:2px solid white;
      box-shadow:0 2px 6px rgba(0,0,0,0.25);
      font-family:system-ui,sans-serif;
    ">${seq}</div>`,
  });
}

export type OrderDot = {
  counterpartyId: string;
  name: string;
  lat: number;
  lng: number;
  number: string;
  amount: number;
  time: string;
  draft: boolean;
};

export default function ShiftTrackMap({
  shiftPath,
  afterShiftPath,
  planGeometry = null,
  planStops = [],
  excursions = [],
  orders = [],
  focusOrderId = null,
  base = null,
  height = "420px",
}: {
  shiftPath: Array<[number, number]>;
  afterShiftPath: Array<[number, number]>;
  /** GeoJSON LineString від OSRM; без неї пункти з'єднуються прямою */
  planGeometry?: { type?: string; coordinates?: [number, number][] } | null;
  planStops?: PlanStop[];
  excursions?: PlanExcursion[];
  /** Клієнти, від яких цього дня є замовлення. */
  orders?: OrderDot[];
  /** Клієнт зі списку поруч, на якому зараз тримають курсор. */
  focusOrderId?: string | null;
  /** База торгового — точка відліку подачі */
  base?: { lat: number; lng: number; address: string | null } | null;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  /** Кільця замовлень за id клієнта — щоб список поруч міг їх підсвічувати. */
  const orderMarkersRef = useRef<Map<string, L.CircleMarker>>(new Map());
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
    // Шар перемальовано — старі посилання на кільця вже нічого не значать.
    orderMarkersRef.current.clear();
    const bounds = L.latLngBounds([]);

    // --- Плановий шар ---
    // Малюється ПЕРШИМ, щоб трек ліг зверху: порівнюють факт із планом, а
    // не навпаки, і саме факт має бути видно там, де лінії збігаються.
    // Товща й прозоріша за трек — читається як підкладка, а не як другий
    // рівноправний маршрут.
    if (planGeometry?.coordinates?.length && planGeometry.coordinates.length > 1) {
      // GeoJSON — [lng, lat], Leaflet чекає [lat, lng]
      const line = planGeometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
      L.polyline(line, { color: PLAN_COLOR, weight: 7, opacity: 0.4 })
        .bindTooltip("Маршрут за планом", { sticky: true })
        .addTo(group);
      line.forEach((c) => bounds.extend(c));
    } else if (planStops.length > 1) {
      // Пунктир: геометрії доріг немає, це лише прямі між пунктами, і
      // видавати їх за проїжджий маршрут не можна.
      const line = planStops.map((s) => [s.lat, s.lng] as [number, number]);
      L.polyline(line, { color: PLAN_COLOR, weight: 5, opacity: 0.35, dashArray: "10 8" })
        .bindTooltip("Маршрут за планом (прямі між пунктами)", { sticky: true })
        .addTo(group);
      line.forEach((c) => bounds.extend(c));
    }

    // База — точка відліку подачі. Домик, а не номер: це не пункт
    // маршруту, і нумерувати його разом із ними означало б збити рахунок.
    if (base) {
      L.marker([base.lat, base.lng], {
        icon: L.divIcon({
          className: "",
          iconSize: [26, 26],
          iconAnchor: [13, 13],
          popupAnchor: [0, -13],
          html: `<div style="
            width:26px;height:26px;border-radius:50%;
            background:#fff;border:2px solid ${PLAN_COLOR};
            display:flex;align-items:center;justify-content:center;
            font-size:13px;
            box-shadow:0 2px 6px rgba(0,0,0,0.25);
          ">🏠</div>`,
        }),
      })
        .bindPopup(
          `<div style="font-family:system-ui;font-size:13px;min-width:170px">
            <strong>База</strong><br/>
            <span style="color:#6B7280">Звідки торговий виїжджає</span>
            ${base.address ? `<br/><span style="color:#9CA3AF;font-size:11px">${escapeHtml(base.address)}</span>` : ""}
          </div>`
        )
        .addTo(group);
      bounds.extend([base.lat, base.lng]);
    }

    planStops.forEach((stop, i) => {
      L.marker([stop.lat, stop.lng], { icon: planPin(i + 1) })
        .bindPopup(
          `<div style="font-family:system-ui;font-size:13px;min-width:170px">
            <strong>${escapeHtml(stop.settlement)}</strong><br/>
            <span style="color:#6B7280">За планом, пункт №${i + 1}</span>
            ${stop.displayName ? `<br/><span style="color:#9CA3AF;font-size:11px">${escapeHtml(stop.displayName)}</span>` : ""}
          </div>`
        )
        .addTo(group);
      bounds.extend([stop.lat, stop.lng]);
    });

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

    // --- Епізоди відхилення ---
    // Останніми, поверх усього: це те, заради чого карту й відкривають.
    // Радіус обмежений знизу й зверху, щоб епізод за 200 м не був
    // невидимою цяткою, а виїзд за 60 км — плямою на пів-області.
    excursions.forEach((e, i) => {
      L.circle([e.lat, e.lng], {
        radius: Math.max(600, Math.min(e.maxDistanceM, 15000)),
        color: "#DC2626",
        fillColor: "#DC2626",
        fillOpacity: 0.12,
        weight: 2,
        dashArray: "6 4",
      })
        .bindPopup(
          `<div style="font-family:system-ui;font-size:13px;min-width:200px">
            <strong style="color:#DC2626">Відхилення №${i + 1}</strong><br/>
            <span style="color:#6B7280">${escapeHtml(e.fromTime)} — ${escapeHtml(e.toTime)}</span><br/>
            Тривалість: <strong>${e.minutes} хв</strong><br/>
            Поза маршрутом: <strong>${e.km} км</strong><br/>
            Найдалі від маршруту: ${(e.maxDistanceM / 1000).toFixed(1)} км
          </div>`
        )
        .addTo(group);
      bounds.extend([e.lat, e.lng]);
    });

    /**
     * Замовлення дня — поверх маршруту.
     *
     * Разом із треком вони й дають відповідь, заради якої зміну
     * відкривають: лінія показує дорогу, кільця — заради чого вона була.
     * Порожнє кільце означає документ, який офіс іще не провів: робота
     * зроблена, грошей у звіті ще немає.
     */
    orders.forEach((o) => {
      const marker = L.circleMarker([o.lat, o.lng], {
        radius: 8,
        color: ORDER_COLOR,
        weight: 3,
        fillColor: o.draft ? "#fff" : ORDER_COLOR,
        fillOpacity: o.draft ? 1 : 0.85,
      })
        .bindTooltip(
          `<b>${escapeHtml(o.name)}</b><br/>` +
            `${money.format(o.amount)} грн${o.draft ? " · не проведене" : ""}<br/>` +
            `<span style="color:#6B7280">№${escapeHtml(o.number)} · документ ${escapeHtml(o.time)}</span>`,
          { direction: "top" }
        )
        .addTo(group);
      bounds.extend([o.lat, o.lng]);
      orderMarkersRef.current.set(o.counterpartyId, marker);
    });

    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [shiftPath, afterShiftPath, planGeometry, planStops, excursions, orders, base]);

  /**
   * Наведення на рядок у списку підсвічує його точку.
   *
   * Без цього список і карта живуть окремо: у списку прізвище, на карті
   * кільце, і зіставляє їх людина очима. Тридцять замовлень у Львові
   * так не зіставиш.
   */
  useEffect(() => {
    orderMarkersRef.current.forEach((marker, id) => {
      const on = id === focusOrderId;
      marker.setStyle({ radius: on ? 13 : 8, weight: on ? 4 : 3 });
      if (on) {
        marker.bringToFront();
        marker.openTooltip();
      } else {
        marker.closeTooltip();
      }
    });
  }, [focusOrderId, orders]);

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
