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
import { clampToUkraine } from "@/components/map/MapFrame";

/** Що торговий може зробити з точки, крім переходу в картку. */
export type SalesMapAction =
  | { kind: "orderCard"; id: string }
  | { kind: "comments"; id: string }
  | { kind: "pin"; id: string };

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
  /**
   * Свій клієнт (закріплений або купував через цю людину).
   *
   * Не фільтр, а вигляд: у режимі «всі» на карті сотні точок, і серед них
   * свої мусять читатися з першого погляду. Поле необовʼязкове — там, де
   * поділу немає, всі точки лишаються звичайними.
   */
  mine?: boolean;
  /**
   * Чи можна цій людині уточнити точку саме цього клієнта.
   *
   * Не завжди збігається з `mine`: чужому клієнту точку можна ПОСТАВИТИ,
   * якщо її ще немає або вона з геокодера, і не можна ПЕРЕСУНУТИ ту, яку
   * вже поставила людина (див. PATCH /api/admin/client-map/[id]). Кнопку,
   * яка гарантовано поверне 403, не показуємо. Поле необовʼязкове —
   * без нього кнопка керується лише `extras.pin`, як і раніше.
   */
  canPin?: boolean;
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

/**
 * Чим комплектувати попап. Карта одна на торгового й водія, а набір дій
 * різний: у водія немає картки клієнта в його розділі (там лише маршрути),
 * зате є коментарі й уточнення піна прямо з карти — він стоїть біля дверей.
 */
export type PopupExtras = {
  comments?: boolean;
  pin?: boolean;
  /** Префікс посилання на картку, напр. "/sales/clients/". Немає — немає кнопки. */
  clientCardHref?: string;
};

/**
 * Вікно по основному скупченню точок, а не по крайніх.
 *
 * У режимі «всі клієнти» серед львівських точок трапляється поодинока на
 * Донеччині — і fitBounds по всіх розтягує карту на пів Європи, де весь
 * робочий регіон стискається в нерозбірливу пляму. Відрізаємо по 5%
 * найдальших з кожного краю: центр ваги лишається там, де водій працює,
 * а поодинокі далекі точки він знайде відтисканням.
 */
function coreBounds(points: Array<{ lat: number; lng: number }>): L.LatLngBounds | null {
  if (points.length < 12) return null; // на десятку точок відрізати нічого

  const cut = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const k = Math.floor(sorted.length * 0.05);
    return [sorted[k], sorted[sorted.length - 1 - k]] as const;
  };

  const [latMin, latMax] = cut(points.map((p) => p.lat));
  const [lngMin, lngMax] = cut(points.map((p) => p.lng));
  return L.latLngBounds([latMin, lngMin], [latMax, lngMax]);
}

/** Кнопка в попапі: однакова геометрія, різний вигляд. */
function popupButton(action: string, id: string, label: string, primary: boolean): string {
  return `<button data-action="${action}" data-id="${escapeHtml(id)}"
     style="display:block;width:100%;margin-top:6px;padding:9px;text-align:center;
     background:${primary ? "#0A0A0A" : "#fff"};color:${primary ? "#fff" : "#0A0A0A"};
     border:${primary ? "none" : "1px solid #E5E7EB"};border-radius:8px;
     font-weight:600;font-size:13px;cursor:pointer">${escapeHtml(label)}</button>`;
}

function popupHtml(c: SalesClientPoint, extras: PopupExtras): string {
  const meta = CLIENT_STATE[c.state];
  // Чужий клієнт — не заборона, а попередження: перш ніж їхати, варто
  // знати, що його вже хтось веде.
  const foreign =
    c.mine === false
      ? `<div style="color:#6B7280;font-size:12px;margin-top:3px">Не закріплений за вами</div>`
      : "";
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
    ${foreign}
    ${popupButton("orderCard", c.id, "Що брав і що везти", true)}
    ${extras.comments ? popupButton("comments", c.id, "Коментарі", false) : ""}
    ${extras.pin && c.canPin !== false ? popupButton("pin", c.id, "Уточнити точку", false) : ""}
    ${
      extras.clientCardHref
        ? `<a href="${escapeHtml(extras.clientCardHref)}${escapeHtml(c.id)}"
       style="display:block;margin-top:6px;padding:8px;text-align:center;
       background:#fff;color:#0A0A0A;border:1px solid #E5E7EB;border-radius:8px;
       text-decoration:none;font-weight:600;font-size:13px">Відкрити картку</a>`
        : ""
    }
  </div>`;
}

export default function SalesClientsMap({
  clients,
  route,
  me,
  onAction,
  extras = { clientCardHref: "/sales/clients/" },
  height = "100%",
  pinning = false,
  onMapClick,
  focus = null,
}: {
  clients: SalesClientPoint[];
  route: SalesRoute;
  /** Де зараз торговий — щоб бачити, хто поряд. */
  me?: { lat: number; lng: number } | null;
  onAction?: (action: SalesMapAction) => void;
  /** Які дії показувати в попапі — набір різний у торгового й водія. */
  extras?: PopupExtras;
  height?: string;
  /** Чекаємо тап по карті, щоб поставити клієнту пін. */
  pinning?: boolean;
  onMapClick?: (lat: number, lng: number) => void;
  /** Куди підлетіти після пошуку; nonce — щоб повторний вибір теж спрацював. */
  focus?: { lat: number; lng: number; id?: string; nonce: number } | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const meRef = useRef<L.CircleMarker | null>(null);
  const fittedRef = useRef(false);
  /** id → маркер: пошук має не лише підлетіти, а й розкрити потрібну точку. */
  const markersRef = useRef(new Map<string, L.CircleMarker>());
  /** Колбек у ref: інакше кожен новий рендер сторінки перемальовував би точки. */
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  /** Теж у ref: `extras` — літерал, новий на кожен рендер сторінки. */
  const extrasRef = useRef(extras);
  extrasRef.current = extras;
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const pinningRef = useRef(pinning);
  pinningRef.current = pinning;

  const key = useMemo(
    () =>
      clients.map((c) => `${c.id}:${c.state}:${c.mine ? 1 : 0}`).join("|") +
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

      clampToUkraine(mapRef.current);

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

      // Тап по карті ставить пін лише коли його справді чекають: у звичайному
      // режимі торговий тапає по карті просто щоб закрити попап.
      mapRef.current.on("click", (e: L.LeafletMouseEvent) => {
        if (!pinningRef.current) return;
        clickRef.current?.(e.latlng.lat, e.latlng.lng);
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

    markersRef.current.clear();
    // Свої малюються ОСТАННІМИ — у Leaflet це означає «поверх». Інакше в
    // режимі «всі» власний магазин ховається під сусідньою чужою точкою
    // саме там, де точок густо: у місті.
    const ordered = spread(clients).sort(
      (a, b) => Number(a.mine === true) - Number(b.mine === true)
    );
    ordered.forEach((c) => {
      const foreign = c.mine === false;
      const marker = L.circleMarker([c.lat, c.lng], {
        // Чужа точка дрібніша й блідіша: видно, що вона є, але вона не
        // перетягує на себе увагу з власного портфеля.
        radius: foreign ? 6 : 9, // свої більші за адмінські 7: ціль для пальця
        color: "#fff",
        weight: foreign ? 1 : 2,
        fillColor: CLIENT_STATE[c.state].color,
        fillOpacity: foreign ? 0.45 : 0.92,
      })
        .bindPopup(popupHtml(c, extrasRef.current), { minWidth: 190 })
        .addTo(group);
      markersRef.current.set(c.id, marker);
      bounds.extend([c.lat, c.lng]);
    });

    if (!fittedRef.current && bounds.isValid()) {
      map.fitBounds(coreBounds(clients) ?? bounds, { padding: [30, 30], maxZoom: 13 });
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

  // Політ до знайденого пошуком клієнта.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 15), { duration: 0.7 });
    if (focus.id) {
      // Попап відкриваємо після польоту: під час анімації Leaflet тягне його
      // разом із картою, і він встигає моргнути в кутку.
      const marker = markersRef.current.get(focus.id);
      if (marker) map.once("moveend", () => marker.openPopup());
    }
  }, [focus]);

  // Приціл замість стрілки: видно, що зараз чекають тап по карті.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().style.cursor = pinning ? "crosshair" : "";
  }, [pinning]);

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
