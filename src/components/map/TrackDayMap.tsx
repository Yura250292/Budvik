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
import { FRAMED_MAP_OPTIONS, MapFrame, attachWheelGate, useMapExpand, useWheelGate } from "./MapFrame";

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
  /**
   * Лінія з добитими розривами: там, де планшет був офлайн, замість
   * прямої через півміста вплетено реальну дорогу. Якщо не передана,
   * малюємо по points — тоді розриви видно як хорди.
   */
  path?: Array<[number, number]>;
  stops: Array<{
    key: string;
    name: string;
    lat: number | null;
    lng: number | null;
    sequence: number;
    visit: { status: string } | null;
  }>;
  /** Призначений маршрут на цей день — те, куди торговий мав їхати. */
  plan?: {
    name: string;
    color: string | null;
    geometry: unknown;
    stops: Array<{ settlement: string; displayName: string | null; lat: number; lng: number; seq: number }>;
  } | null;
  /**
   * Клієнти, від яких сьогодні є замовлення.
   *
   * Не те саме, що stops: там план і відмітки візитів, а тут факт із 1С.
   * Разом вони й дають відповідь, заради якої карту відкривають, — куди
   * доїхав і що з того вийшло.
   */
  orders?: Array<{
    counterpartyId: string;
    name: string;
    lat: number;
    lng: number;
    number: string;
    amount: number;
    time: string;
    draft: boolean;
  }>;
  /** Епізоди виходу за коридор маршруту. */
  excursions?: Array<{
    from: string;
    to: string;
    minutes: number;
    km: number;
    maxDistanceM: number;
    lat: number;
    lng: number;
  }>;
};

/** Колір планової лінії за замовчуванням — той самий, що на вкладці торгових. */
const PLAN_COLOR = "#FFB800";

/**
 * Колір замовлення. Фіолетовий навмисно: зелений і червоний на цій карті
 * уже зайняті статусами візитів, синій — треком, жовтий — планом.
 */
const ORDER_COLOR = "#7C3AED";

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/** Час епізоду в «14:05» за Києвом: сервер віддає ISO. */
function kyivClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  /** За замовчуванням тягнеться на всю обгортку: висоту задає сторінка. */
  height = "100%",
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
  /**
   * Кому вже підганяли масштаб під маршрут.
   *
   * Деталі дня тепер перепитуються кожні пів хвилини, щоб слід ріс сам.
   * Якби на кожну відповідь карта знову робила fitBounds, вона щоразу
   * відстрибувала б до загального плану — і роздивитися щось було б
   * неможливо. Тому масштаб підганяємо один раз на вибрану людину.
   */
  const fittedDetailRef = useRef<string | null>(null);
  const { wheelActive, onWheelChange } = useWheelGate();
  const { expanded, toggle } = useMapExpand(mapRef);
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
    if (!detail) {
      // Вибір знято: наступного разу масштаб підганяємо заново.
      fittedDetailRef.current = null;
      return;
    }

    const bounds = L.latLngBounds([]);

    /**
     * План малюємо ПЕРШИМ, щоб він лишився підкладкою: важливий не він,
     * а те, наскільки від нього відхилилися. Жовта широка лінія під
     * синім треком читається як «коридор, у якому мали їхати».
     */
    const plan = detail.plan;
    if (plan) {
      const planColor = plan.color || PLAN_COLOR;
      const geo = plan.geometry as { coordinates?: [number, number][] } | null;

      if (geo?.coordinates && geo.coordinates.length >= 2) {
        // GeoJSON — [lng, lat], Leaflet чекає [lat, lng]
        const planLine = geo.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
        L.polyline(planLine, { color: planColor, weight: 7, opacity: 0.35 }).addTo(group);
        planLine.forEach((c) => bounds.extend(c));
      } else if (plan.stops.length >= 2) {
        // Геометрії доріг немає — пунктир між пунктами, щоб не видавати
        // пряму через поля за справжній маршрут.
        const planLine = plan.stops.map((s) => [s.lat, s.lng] as [number, number]);
        L.polyline(planLine, {
          color: planColor,
          weight: 5,
          opacity: 0.35,
          dashArray: "8 6",
        }).addTo(group);
        planLine.forEach((c) => bounds.extend(c));
      }

      // Пункти плану — квадратами, щоб не плутати з круглими точками
      // фактичного маршруту й відмітками.
      plan.stops.forEach((s) => {
        L.marker([s.lat, s.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="width:24px;height:24px;border-radius:6px;background:${planColor};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:600 11px/1 system-ui;color:#1F2937;transform:translate(-12px,-12px)">${s.seq + 1}</div>`,
            iconSize: [0, 0],
          }),
        })
          .bindTooltip(`За планом: ${escapeHtml(s.settlement)}`, { direction: "top" })
          .addTo(group);
        bounds.extend([s.lat, s.lng]);
      });
    }

    if (detail.points.length > 1) {
      // path уже з добитими розривами; points — запасний варіант.
      const line =
        detail.path && detail.path.length > 1
          ? detail.path
          : detail.points.map((p) => [p.lat, p.lng] as [number, number]);
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

    /**
     * Замовлення — поверх маршруту, останнім шаром перед відхиленнями.
     *
     * Свідомо іншою формою, ніж зупинки плану: там кружок із заливкою,
     * тут кільце з підписом суми. Дві однакові цятки різного змісту на
     * одній карті читаються гірше, ніж жодної.
     *
     * Порожнє кільце — непроведений документ: замовлення торговий уже
     * набрав, але офіс іще не підтвердив. Так на сьогоднішньому дні
     * видно роботу, яка інакше з'явилась би аж завтра.
     */
    (detail.orders ?? []).forEach((o) => {
      L.circleMarker([o.lat, o.lng], {
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
    });

    /**
     * Відхилення — колом, а не маркером: епізод це область і тривалість,
     * а не одна точка. Малюємо останніми, поверх усього, бо саме заради
     * них керівник і відкриває цей день.
     */
    (detail.excursions ?? []).forEach((e, i) => {
      L.circle([e.lat, e.lng], {
        // Стеля й підлога радіуса: без них епізод на 40 км залив би пів
        // області, а короткий став би невидимою цяткою.
        radius: Math.max(600, Math.min(e.maxDistanceM, 15_000)),
        color: "#DC2626",
        fillColor: "#DC2626",
        fillOpacity: 0.12,
        weight: 2,
        dashArray: "6 4",
      })
        .bindPopup(
          `<div style="font:13px/1.5 system-ui">
             <b>Відхилення №${i + 1}</b><br/>
             ${kyivClock(e.from)} — ${kyivClock(e.to)}<br/>
             Тривалість: ${e.minutes} хв<br/>
             Поза маршрутом: ${e.km} км<br/>
             Найдалі від маршруту: ${Math.round(e.maxDistanceM / 100) / 10} км
           </div>`
        )
        .addTo(group);
      bounds.extend([e.lat, e.lng]);
    });

    if (bounds.isValid() && fittedDetailRef.current !== selectedId) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      fittedDetailRef.current = selectedId;
    }
  }, [detail, selectedId]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      peopleLayerRef.current = null;
      detailLayerRef.current = null;
    };
  }, []);

  return (
    <MapFrame
      height={height}
      wheelActive={wheelActive}
      expanded={expanded}
      onToggleExpand={toggle}
    >
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
    </MapFrame>
  );
}
