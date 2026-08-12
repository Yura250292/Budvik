"use client";

/**
 * Карта клієнтів: кожна точка — контрагент, колір — стан активності.
 *
 * Окремо від RoutesOverviewMap, бо там кілька полілінь із пронумерованими
 * зупинками, а тут сотні рівноправних точок, які треба швидко малювати й
 * перемальовувати при кожному перемиканні фільтра. Тому circleMarker на
 * canvas-рендерері: з divIcon на кожну точку вкладка помітно підвисає вже
 * на кількох сотнях маркерів.
 *
 * Точки для розпрацювання навмисно квадратні: колір не може бути єдиною
 * відмінністю — і через дальтонізм, і бо їх плутали б із клієнтами.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CLIENT_STATE } from "@/lib/analytics/colors";
import type { OverviewRoute } from "./RoutesOverviewMap";

export type ClientPoint = {
  counterpartyId: string;
  name: string;
  lat: number;
  lng: number;
  state: keyof typeof CLIENT_STATE;
  daysSinceLast: number;
  avgIntervalDays: number;
  docs: number;
  amount: number;
  address: string | null;
  geoSource: string | null;
  reps: Array<{ id: string; name: string }>;
};

export type ProspectPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  notes: string | null;
  status: string;
  assignedRep: { id: string; name: string } | null;
};

export type MapMode = "view" | "addProspect" | "movePin";

export type MapAction =
  | { kind: "moveClient"; id: string }
  | { kind: "comments"; id: string }
  | { kind: "editProspect"; id: string }
  | { kind: "moveProspect"; id: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/**
 * Розводить точки, що потрапили в одні координати.
 *
 * Геокодер часто не знаходить будинок і віддає центр міста — у Львові так
 * зійшлося сім клієнтів в одну точку. Верхній пін накриває решту, і їх
 * просто не видно: на карті це виглядає як один клієнт замість семи.
 * Тому дублікати розкладаємо кільцем радіусом ~40 м — достатньо, щоб
 * кожен був клікабельний, і замало, щоб збрехати про розташування.
 */
function spreadOverlaps<T extends { lat: number; lng: number }>(
  points: T[]
): Array<T & { spread: boolean }> {
  const counts = new Map<string, number>();
  const keyOf = (p: { lat: number; lng: number }) => `${p.lat.toFixed(4)}:${p.lng.toFixed(4)}`;
  points.forEach((p) => counts.set(keyOf(p), (counts.get(keyOf(p)) ?? 0) + 1));

  const seen = new Map<string, number>();
  return points.map((p) => {
    const key = keyOf(p);
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    // Позначаємо всю групу, а не лише зсунутих: перший пін групи теж стоїть
    // не за своєю адресою, просто його не довелося рухати.
    const spread = (counts.get(key) ?? 1) > 1;
    if (index === 0) return { ...p, spread };

    // Спіраль Ферма, а не кільце: у центрі Львова в одну точку сходяться
    // 60 клієнтів, і кільцями по 8 вони лягли б сімома колами одне на
    // одне. Тут радіус росте як √n, тож щільність лишається однаковою і
    // група читається на будь-якому розмірі — від двох точок до сотні.
    const angle = index * 2.399963; // золотий кут, дає рівномірний розподіл
    const offset = 0.00028 * Math.sqrt(index);
    return {
      ...p,
      spread,
      lat: p.lat + offset * Math.sin(angle),
      lng: p.lng + (offset * Math.cos(angle)) / Math.cos((p.lat * Math.PI) / 180),
    };
  });
}

function prospectPin(color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9],
    html: `<div style="
      width:18px;height:18px;border-radius:3px;
      background:${color};border:2px solid white;
      box-shadow:0 1px 5px rgba(0,0,0,0.35);
    "></div>`,
  });
}

const PROSPECT_STATUS_LABEL: Record<string, string> = {
  NEW: "Нова",
  IN_PROGRESS: "В роботі",
  CONVERTED: "Стала клієнтом",
  REJECTED: "Відмова",
};

function clientPopup(c: ClientPoint & { spread?: boolean }): string {
  const meta = CLIENT_STATE[c.state];
  const rhythm =
    c.avgIntervalDays > 0
      ? `раз на ~${Math.round(c.avgIntervalDays)} дн.`
      : "замало документів для ритму";
  const reps = c.reps.length ? c.reps.map((r) => escapeHtml(r.name)).join(", ") : "не закріплений";

  return `<div style="font-family:system-ui;font-size:13px;min-width:220px;max-width:280px">
    <strong>${escapeHtml(c.name)}</strong><br/>
    <span style="display:inline-block;margin:4px 0;padding:1px 7px;border-radius:9px;
      background:${meta.color};color:#fff;font-size:11px;font-weight:700">
      ${escapeHtml(meta.label)}
    </span><br/>
    <span style="color:#6B7280">Останній документ: </span><strong>${c.daysSinceLast} дн. тому</strong><br/>
    <span style="color:#6B7280">Ритм: </span>${escapeHtml(rhythm)}<br/>
    <span style="color:#6B7280">За період: </span>${c.docs} док. · ${escapeHtml(money.format(c.amount))} грн<br/>
    <span style="color:#6B7280">Торговий: </span>${reps}
    ${c.address ? `<br/><span style="color:#9CA3AF;font-size:11px">${escapeHtml(c.address)}</span>` : ""}
    ${c.geoSource === "MANUAL" ? `<br/><span style="color:#9CA3AF;font-size:11px">пін виставлено вручну</span>` : ""}
    ${c.geoSource === "CITY" ? `<br/><span style="color:#B45309;font-size:11px">приблизно: знайдено лише населений пункт</span>` : ""}
    <br/><button data-action="comments" data-id="${escapeHtml(c.counterpartyId)}"
      style="margin-top:7px;padding:3px 9px;border:1px solid #D1D5DB;border-radius:6px;
      background:#fff;cursor:pointer;font-size:12px">Коментарі</button>
    <button data-action="moveClient" data-id="${escapeHtml(c.counterpartyId)}"
      style="margin-top:7px;margin-left:5px;padding:3px 9px;border:1px solid #D1D5DB;border-radius:6px;
      background:#fff;cursor:pointer;font-size:12px">Перемістити пін</button>
  </div>`;
}

function prospectPopup(p: ProspectPoint): string {
  const meta = CLIENT_STATE.PROSPECT;
  return `<div style="font-family:system-ui;font-size:13px;min-width:210px;max-width:280px">
    <strong>${escapeHtml(p.name)}</strong><br/>
    <span style="display:inline-block;margin:4px 0;padding:1px 7px;border-radius:9px;
      background:${meta.color};color:#fff;font-size:11px;font-weight:700">
      ${escapeHtml(meta.label)}
    </span>
    <span style="color:#6B7280;font-size:11px"> · ${escapeHtml(PROSPECT_STATUS_LABEL[p.status] ?? p.status)}</span><br/>
    <span style="color:#6B7280">Доручено: </span>${p.assignedRep ? escapeHtml(p.assignedRep.name) : "нікому"}
    ${p.address ? `<br/><span style="color:#9CA3AF;font-size:11px">${escapeHtml(p.address)}</span>` : ""}
    ${p.notes ? `<br/><span style="color:#4B5563;font-size:12px">${escapeHtml(p.notes)}</span>` : ""}
    <br/><button data-action="editProspect" data-id="${escapeHtml(p.id)}"
      style="margin-top:7px;padding:3px 9px;border:1px solid #D1D5DB;border-radius:6px;
      background:#fff;cursor:pointer;font-size:12px">Редагувати</button>
    <button data-action="moveProspect" data-id="${escapeHtml(p.id)}"
      style="margin-top:7px;margin-left:5px;padding:3px 9px;border:1px solid #D1D5DB;border-radius:6px;
      background:#fff;cursor:pointer;font-size:12px">Перемістити</button>
  </div>`;
}

export default function ClientMap({
  clients,
  prospects,
  overlayRoutes = [],
  mode = "view",
  onMapClick,
  onAction,
  focus = null,
  height = "clamp(300px, 52vh, 460px)",
}: {
  clients: ClientPoint[];
  prospects: ProspectPoint[];
  overlayRoutes?: OverviewRoute[];
  mode?: MapMode;
  onMapClick?: (lat: number, lng: number) => void;
  onAction?: (action: MapAction) => void;
  /** Куди підлетіти: пошук передає знайденого клієнта разом із nonce, щоб
   *  повторний вибір того самого теж спрацював. */
  focus?: { lat: number; lng: number; id?: string; nonce: number } | null;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const rendererRef = useRef<L.Renderer | null>(null);
  /** Чи колесо зараз масштабує карту — показуємо підказкою, щоб не гадали. */
  const [wheelActive, setWheelActive] = useState(false);
  /** counterpartyId → маркер: щоб пошук міг розкрити попап знайденого. */
  const markersRef = useRef(new Map<string, L.CircleMarker>());
  /** Колбеки в ref: інакше кожна зміна режиму перемальовувала б усі точки. */
  const clickRef = useRef(onMapClick);
  const actionRef = useRef(onAction);
  const modeRef = useRef(mode);
  /** Перший показ центрує карту, далі — ні: інакше фільтр смикав би вигляд. */
  const fittedRef = useRef(false);

  clickRef.current = onMapClick;
  actionRef.current = onAction;
  modeRef.current = mode;

  // Ключ змісту: масиви приходять новими об'єктами на кожен рендер вкладки,
  // а перемальовувати сотні маркерів треба лише коли справді щось змінилось.
  const contentKey = useMemo(
    () =>
      [
        clients.map((c) => `${c.counterpartyId}:${c.state}:${c.lat.toFixed(5)}:${c.lng.toFixed(5)}`).join("|"),
        prospects.map((p) => `${p.id}:${p.status}:${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`).join("|"),
        overlayRoutes.map((r) => r.id).join("|"),
      ].join("#"),
    [clients, prospects, overlayRoutes]
  );

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        // Колесо гортає сторінку, а не масштабує: карта займає всю ширину,
        // і при скролі повз неї сторінка інакше «залипає» на зумі. Масштаб
        // вмикається кліком по карті (нижче) або Ctrl+колесом.
        scrollWheelZoom: false,
      }).setView([49.8397, 24.0297], 8); // Львів — центр робочої зони

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(mapRef.current);

      rendererRef.current = L.canvas({ padding: 0.3 });
      layersRef.current = L.layerGroup().addTo(mapRef.current);

      // Попапи — рядки HTML, тож React-обробник на кнопку не почепиш:
      // ловимо клік делегуванням на відкритому попапі.
      mapRef.current.on("popupopen", (e: L.PopupEvent) => {
        const root = e.popup.getElement();
        root?.querySelectorAll<HTMLElement>("[data-action]").forEach((btn) => {
          btn.onclick = () => {
            const kind = btn.dataset.action as MapAction["kind"];
            const id = btn.dataset.id;
            if (!kind || !id) return;
            mapRef.current?.closePopup();
            actionRef.current?.({ kind, id } as MapAction);
          };
        });
      });

      mapRef.current.on("click", (e: L.LeafletMouseEvent) => {
        // Клік по карті означає «я тут працюю» — вмикаємо зум колесом.
        // Вихід курсора за межі знову віддає колесо сторінці.
        mapRef.current?.scrollWheelZoom.enable();
        setWheelActive(true);
        if (modeRef.current === "view") return;
        clickRef.current?.(e.latlng.lat, e.latlng.lng);
      });

      mapRef.current.on("mouseout", () => {
        mapRef.current?.scrollWheelZoom.disable();
        setWheelActive(false);
      });
    }

    const map = mapRef.current;
    const group = layersRef.current;
    const renderer = rendererRef.current;
    if (!group || !renderer) return;

    group.clearLayers();
    const bounds = L.latLngBounds([]);

    // Маршрути малюємо першими — вони мусять лежати під точками.
    overlayRoutes.forEach((route) => {
      if (route.geometry?.coordinates?.length) {
        const line = route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
        L.polyline(line, { color: route.color, weight: 3, opacity: 0.35 })
          .bindTooltip(route.name, { sticky: true })
          .addTo(group);
      } else if (route.stops.length >= 2) {
        const line = route.stops.map((s) => [s.lat, s.lng] as [number, number]);
        L.polyline(line, { color: route.color, weight: 3, opacity: 0.3, dashArray: "8 6" })
          .bindTooltip(route.name, { sticky: true })
          .addTo(group);
      }
    });

    markersRef.current.clear();
    spreadOverlaps(clients).forEach((c) => {
      // Точку, знайдену лише до міста, малюємо порожнистою: колір стану
      // лишається (він правдивий), але заливка зникає — видно, що місце
      // приблизне. Суцільний пін на такій точці брехав би про адресу.
      const cityOnly = c.geoSource === "CITY";
      const marker = L.circleMarker([c.lat, c.lng], {
        renderer,
        radius: cityOnly ? 6 : 7,
        color: cityOnly ? CLIENT_STATE[c.state].color : "#ffffff",
        weight: cityOnly ? 2 : 1.5,
        fillColor: cityOnly ? "#ffffff" : CLIENT_STATE[c.state].color,
        fillOpacity: cityOnly ? 0.55 : 0.9,
      })
        .bindPopup(clientPopup(c))
        .bindTooltip(c.name, { direction: "top" })
        .addTo(group);
      // Тримаємо маркери за id: пошук має не лише підлетіти до точки, а й
      // розкрити її попап — інакше серед сусідніх пінів не ясно, який знайшли.
      markersRef.current.set(c.counterpartyId, marker);
      bounds.extend([c.lat, c.lng]);
    });

    prospects.forEach((p) => {
      L.marker([p.lat, p.lng], { icon: prospectPin(CLIENT_STATE.PROSPECT.color) })
        .bindPopup(prospectPopup(p))
        .bindTooltip(p.name, { direction: "top" })
        .addTo(group);
      bounds.extend([p.lat, p.lng]);
    });

    if (!fittedRef.current && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      fittedRef.current = true;
    }
    // Перемальовуємо за змістовим ключем, не за посиланнями на масиви
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentKey]);

  // Політ до знайденого пошуком клієнта.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 14), { duration: 0.7 });
    if (focus.id) {
      // Попап відкриваємо після польоту: під час анімації Leaflet зсуває
      // його разом із картою, і він встигає моргнути в кутку.
      const marker = markersRef.current.get(focus.id);
      if (marker) map.once("moveend", () => marker.openPopup());
    }
  }, [focus]);

  // Курсор — підказка, що зараз чекають клік по карті.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().style.cursor = mode === "view" ? "" : "crosshair";
  }, [mode]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layersRef.current = null;
      rendererRef.current = null;
    };
  }, []);

  return (
    // isolate створює власний стековий контекст: панелі Leaflet мають
    // z-index до 1000 і без цього перекривали б шапку та бічне меню при
    // скролі — карта «їздила» поверх сторінки. Тепер її шари лишаються
    // всередині блока, хай який у них z-index.
    <div
      className="relative isolate overflow-hidden rounded-[12px] border border-line"
      style={{ height, width: "100%", contain: "layout paint" }}
    >
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />

      {mode !== "view" && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[400] -translate-x-1/2 rounded-full bg-bk/85 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
          {mode === "addProspect"
            ? "Клікніть на карті, де стоїть майбутній клієнт"
            : "Клікніть на карті, куди перенести точку"}
        </div>
      )}

      {mode === "view" && !wheelActive && (
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-[400] -translate-x-1/2 rounded-full bg-white/90 px-2.5 py-1 text-[11px] text-gr shadow">
          Клікніть на карту, щоб масштабувати колесом
        </div>
      )}
    </div>
  );
}
