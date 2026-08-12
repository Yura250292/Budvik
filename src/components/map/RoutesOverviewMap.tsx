"use client";

/**
 * Оглядова мапа напрямків: багато маршрутів одночасно, кожен своїм кольором.
 *
 * Окремо від RouteDayMap, бо там два шари з різним сенсом (план проти факту)
 * для одного торгового на один день, а тут N рівноправних маршрутів, які треба
 * розрізняти за кольором відповідального. Шари тримаємо в одній LayerGroup:
 * при десятках полілінь обхід усіх шарів мапи з instanceof — надто крихкий.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CLIENT_STATE } from "@/lib/analytics/colors";

/** Клієнт на карті напрямків. Форма збігається з ClientPoint карти клієнтів. */
export type MapClientPoint = {
  counterpartyId: string;
  name: string;
  lat: number;
  lng: number;
  state: keyof typeof CLIENT_STATE;
  address: string | null;
  geoSource: string | null;
  amount: number;
  daysSinceLast: number;
  reps: Array<{ id: string; name: string }>;
};

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

/**
 * Зона напрямку: смуга навколо маршруту плюс точки для розпрацювання.
 *
 * Малюється ПІД маршрутом і під його пінами: смуга — це контекст, а не
 * головний об'єкт, і не має перекривати саму дорогу.
 */
export type ZoneOverlay = {
  /** Прямокутники вздовж відрізків і кола на стиках — разом дають смугу */
  shapes: { segments: Array<Array<[number, number]>>; circles: Array<{ center: [number, number]; radiusM: number }> };
  points: ZonePoint[];
};

export type ZonePoint = {
  id: string;
  kind: "OTHER_REP" | "WINBACK" | "PROSPECT" | "WHITE_SPOT";
  name: string;
  lat: number;
  lng: number;
  distanceKm: number;
  subtitle?: string | null;
};

/** Кольори шарів зони. Форма піна теж різна — колір сам по собі не носій сенсу. */
const ZONE_STYLE: Record<ZonePoint["kind"], { color: string; label: string }> = {
  OTHER_REP: { color: "#2a78d6", label: "Чужий / нічий" },
  WINBACK: { color: "#eb6834", label: "Сплячий, втрачений" },
  PROSPECT: { color: "#4a3aa7", label: "Проспект" },
  WHITE_SPOT: { color: "#6B7280", label: "Біла пляма" },
};

function zonePin(kind: ZonePoint["kind"]): L.DivIcon {
  const { color } = ZONE_STYLE[kind];
  // Біла пляма — квадрат-пунктир: це не точка на місцевості, а цілий НП.
  const shape =
    kind === "WHITE_SPOT"
      ? `border-radius:3px;border:2px dashed ${color};background:rgba(255,255,255,0.9)`
      : `border-radius:50%;border:2px solid white;background:${color}`;
  return L.divIcon({
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    popupAnchor: [0, -7],
    html: `<div style="width:14px;height:14px;${shape};box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>`,
  });
}

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
  zone = null,
  clients = [],
  onZonePointClick,
}: {
  routes: OverviewRoute[];
  legend?: LegendEntry[];
  height?: string;
  zone?: ZoneOverlay | null;
  /** Клієнти зі станами — той самий набір, що на «Карті клієнтів» */
  clients?: MapClientPoint[];
  onZonePointClick?: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const zoneRef = useRef<L.LayerGroup | null>(null);
  const clientsRef = useRef<L.LayerGroup | null>(null);
  /**
   * Клієнти — на canvas, а не divIcon: їх сотні, і при перемиканні шару
   * DOM-маркери підвішують вкладку. Той самий підхід, що на карті клієнтів.
   */
  const rendererRef = useRef<L.Renderer | null>(null);
  /** Чи колесо зараз масштабує карту — інакше незрозуміло, чому не зумиться. */
  const [wheelActive, setWheelActive] = useState(false);

  // Обробник у ref: інакше зміна колбека з боку батька перемальовувала б
  // усі точки зони, хоч самі точки ті самі.
  const clickRef = useRef(onZonePointClick);
  clickRef.current = onZonePointClick;

  // Ключ змісту: інакше ефект перемальовував би мапу на кожен рендер вкладки,
  // навіть коли масив той самий за значенням.
  const routesKey = useMemo(
    () => routes.map((r) => `${r.id}:${r.color}:${r.stops.length}`).join("|"),
    [routes]
  );

  // Зона міняється від повзунка радіуса — свій ключ, щоб рух повзунка не
  // перебудовував шар маршрутів (там fitBounds, і мапа б смикалася).
  const zoneKey = useMemo(() => {
    if (!zone) return "";
    return `${zone.shapes.segments.length}:${zone.shapes.circles.length}:${zone.points.length}:${zone.shapes.circles[0]?.radiusM ?? 0}`;
  }, [zone]);

  // Шар клієнтів теж окремо: перемикання галочки станів не мусить чіпати
  // ні маршрути (там fitBounds), ні смугу зони.
  const clientsKey = useMemo(
    () => `${clients.length}:${clients.map((c) => c.counterpartyId).join("").length}`,
    [clients]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        // Колесо гортає сторінку, а не масштабує: карта на всю ширину, і при
        // скролі повз неї сторінка інакше «залипає» на зумі. Масштаб
        // вмикається кліком по карті, вихід курсора його знімає.
        scrollWheelZoom: false,
      }).setView([49.8397, 24.0297], 8); // Львів — типовий центр напрямків

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(mapRef.current);

      rendererRef.current = L.canvas({ padding: 0.3 });

      // Порядок додавання в межах одного пану визначає, що зверху.
      // Знизу вгору: смуга зони → клієнти → маршрути з пінами. Смуга
      // напівпрозора і глушила б полілінію, якби лягла на неї.
      zoneRef.current = L.layerGroup().addTo(mapRef.current);
      clientsRef.current = L.layerGroup().addTo(mapRef.current);
      layersRef.current = L.layerGroup().addTo(mapRef.current);

      mapRef.current.on("click", () => {
        mapRef.current?.scrollWheelZoom.enable();
        setWheelActive(true);
      });
      mapRef.current.on("mouseout", () => {
        mapRef.current?.scrollWheelZoom.disable();
        setWheelActive(false);
      });
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

  // Зона — окремий ефект від маршрутів: рух повзунка радіуса не мусить
  // чіпати fitBounds, бо мапа б стрибала на кожен крок.
  useEffect(() => {
    const group = zoneRef.current;
    if (!group) return;

    group.clearLayers();
    if (!zone) return;

    const bandStyle = {
      color: "#0F766E",
      weight: 1,
      opacity: 0.35,
      fillColor: "#14B8A6",
      fillOpacity: 0.12,
      interactive: false, // смуга не мусить перехоплювати кліки по пінах
    };

    zone.shapes.segments.forEach((ring) => {
      L.polygon(ring, bandStyle).addTo(group);
    });
    zone.shapes.circles.forEach(({ center, radiusM }) => {
      L.circle(center, { ...bandStyle, radius: radiusM }).addTo(group);
    });

    zone.points.forEach((p) => {
      const style = ZONE_STYLE[p.kind];
      const marker = L.marker([p.lat, p.lng], { icon: zonePin(p.kind) }).bindPopup(
        `<div style="font-family:system-ui;font-size:13px;min-width:180px">
          <strong>${escapeHtml(p.name)}</strong><br/>
          <span style="color:${style.color};font-weight:600">${escapeHtml(style.label)}</span>
          <span style="color:#6B7280"> · ${p.distanceKm.toFixed(1)} км від маршруту</span>
          ${p.subtitle ? `<br/><span style="color:#6B7280">${escapeHtml(p.subtitle)}</span>` : ""}
        </div>`
      );
      if (clickRef.current) marker.on("click", () => clickRef.current?.(p.id));
      marker.addTo(group);
    });
    // Перемальовуємо за змістовим ключем — див. коментар до routesKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneKey]);

  // Клієнти: той самий вигляд, що на «Карті клієнтів» — колір за станом,
  // порожній кружечок для тих, чий пін стоїть у центрі НП, а не на адресі.
  useEffect(() => {
    const group = clientsRef.current;
    const renderer = rendererRef.current;
    if (!group || !renderer) return;

    group.clearLayers();

    clients.forEach((c) => {
      const meta = CLIENT_STATE[c.state];
      if (!meta) return;
      const cityOnly = c.geoSource === "CITY";

      L.circleMarker([c.lat, c.lng], {
        renderer,
        radius: 5,
        color: cityOnly ? meta.color : "#ffffff",
        weight: cityOnly ? 2 : 1.5,
        fillColor: cityOnly ? "#ffffff" : meta.color,
        fillOpacity: cityOnly ? 0.55 : 0.9,
      })
        .bindPopup(
          `<div style="font-family:system-ui;font-size:13px;min-width:200px">
            <strong>${escapeHtml(c.name)}</strong><br/>
            <span style="color:${meta.color};font-weight:600">${escapeHtml(meta.label)}</span>
            <span style="color:#6B7280"> · ${c.daysSinceLast} дн. без документа</span>
            ${c.address ? `<br/><span style="color:#6B7280;font-size:11px">${escapeHtml(c.address)}</span>` : ""}
            <br/><span style="color:#6B7280;font-size:11px">${
              c.reps.length ? escapeHtml(c.reps.map((r) => r.name).join(", ")) : "не закріплений"
            }</span>
            ${cityOnly ? `<br/><span style="color:#9CA3AF;font-size:11px">пін у центрі НП — адресу треба уточнити</span>` : ""}
          </div>`
        )
        .bindTooltip(c.name, { direction: "top" })
        .addTo(group);
    });
    // Перемальовуємо за змістовим ключем — див. коментар до routesKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientsKey]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current = null;
      zoneRef.current = null;
      clientsRef.current = null;
      rendererRef.current = null;
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

      {!wheelActive && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-[400] -translate-x-1/2 rounded-full bg-white/90 px-2.5 py-1 text-[11px] text-gr shadow">
          Клікніть на карту, щоб масштабувати колесом
        </div>
      )}
    </div>
  );
}
