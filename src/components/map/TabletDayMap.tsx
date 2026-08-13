"use client";

/**
 * Карта дня для планшета в машині.
 *
 * Три шари, кожен відповідає на своє питання: пройдений трек — «де я
 * був», точки маршруту — «куди мені треба», колір точки — «що я там уже
 * відмітив».
 *
 * Чому MapLibre, а не Leaflet, як на решті карт сайту: це єдина карта, на
 * яку дивляться на ходу. Leaflet растровий — зум у нього ступінчастий
 * (13, 14, 15), карту не повернеш за курсом і не нахилиш. Для адмінських
 * карт цього досить, для навігації — ні. MapLibre малює векторні тайли,
 * тому зум плавний, поворот і нахил безкоштовні, а карта під час руху
 * поводиться як у звичайному навігаторі.
 *
 * Базові тайли — OpenFreeMap: ті самі дані OSM, але векторні, без ключа
 * й без ліміту. Пробки — окремим растровим шаром TomTom через наш проксі
 * (/api/traffic), бо ключ не можна віддавати в браузер.
 *
 * Окремо від SalesClientsMap, бо задача інша: там клієнти за станом
 * продажів (сплячий, втрачений), тут точки за статусом візиту. Спільне —
 * розмір маркерів під палець і відсутність зайвого керування.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// MapLibre 4, а не 5/6: у нових версіях воркер створюється як ES-модуль з
// blob-URL, і в Next.js він падає на старті — стиль просто не дозавантажується.
// Четверта гілка збирає воркер класично і працює без бубна.
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

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
  /** PICKUP/ERRAND — бонусна поїздка: без товару й без інкасації */
  kind: "DELIVERY" | "PICKUP" | "ERRAND";
  notes: string | null;
  visit: { status: string; money: string; collectedAmount: number | null } | null;
};

/** Кольори статусів: сірий — ще не був, зелений — приїхав, червоний — не потрапив. */
const STOP_COLOR = {
  PENDING: "#6B7280",
  DONE: "#16A34A",
  MISSED: "#DC2626",
} as const;

/** Векторний стиль OSM без ключа. */
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** Україна: далі карту не відпускаємо, як і на решті карт сайту. */
const UA_BOUNDS: [number, number, number, number] = [22, 44, 40.3, 52.5];

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
  // Кнопка, а не лінк на Google Maps: вихід у зовнішній застосунок
  // відправляє вкладку у фон і рве трек. Дорогу малює наша карта.
  const nav =
    s.lat != null && s.lng != null
      ? `<button data-nav="${escapeHtml(s.key)}"
           style="display:block;width:100%;margin-top:8px;padding:9px;text-align:center;
           background:#2563EB;color:#fff;border:none;border-radius:8px;
           font-weight:600;font-size:13px;cursor:pointer">Навігація</button>`
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

/** GeoJSON LineString у координатах OSRM: [lng, lat][] */
export type RouteLine = { type: string; coordinates: [number, number][] } | null;

/** Позиція + рух водія. Те, що віддає useTrackRecorder. */
export type MapMotion = {
  lat: number;
  lng: number;
  speedKmh: number | null;
  headingDeg: number | null;
  accuracyM: number | null;
};

/**
 * Зум за швидкістю — головне, заради чого все це.
 *
 * Стоїш біля магазину — видно двір і під'їзд. Їдеш містом — видно
 * наступні перехрестя. Вийшов на трасу — видно кілометри вперед, бо на
 * 90 км/год карта зумом 17 просто пролітає повз.
 *
 * Проміжні значення інтерполюємо, щоб карта «дихала» плавно, а не
 * клацала між двома станами на 39 і 41 км/год.
 */
const ZOOM_BY_SPEED: Array<{ kmh: number; zoom: number }> = [
  { kmh: 0, zoom: 17 },
  { kmh: 20, zoom: 16.3 },
  { kmh: 50, zoom: 15.2 },
  { kmh: 80, zoom: 14.3 },
  { kmh: 110, zoom: 13.6 },
];

function zoomForSpeed(kmh: number | null): number {
  if (kmh == null || !Number.isFinite(kmh)) return 16;
  const v = Math.max(0, kmh);
  const pts = ZOOM_BY_SPEED;
  if (v <= pts[0].kmh) return pts[0].zoom;
  for (let i = 1; i < pts.length; i++) {
    if (v <= pts[i].kmh) {
      const a = pts[i - 1];
      const b = pts[i];
      const t = (v - a.kmh) / (b.kmh - a.kmh);
      return a.zoom + t * (b.zoom - a.zoom);
    }
  }
  return pts[pts.length - 1].zoom;
}

/**
 * Нахил камери: що швидше їдемо, то більше дивимось уперед, а не собі
 * під колеса. Рівно так поводяться Google Maps і Waze у режимі руху.
 */
function pitchForSpeed(kmh: number | null): number {
  if (kmh == null || kmh < 5) return 0;
  return Math.min(50, 20 + (kmh / 110) * 30);
}

/** Режим карти: їдемо за водієм чи роздивляємось увесь маршрут. */
export type MapMode = "follow" | "overview";

export default function TabletDayMap({
  stops,
  trail,
  me,
  motion,
  planned,
  nav,
  onNavigate,
  mode = "overview",
  onModeChange,
  traffic = false,
  height = "100%",
}: {
  stops: TabletStop[];
  /** Пройдений сьогодні шлях */
  trail: Array<[number, number]>;
  me?: { lat: number; lng: number } | null;
  /** Швидкість і курс — керують зумом, поворотом і нахилом камери */
  motion?: MapMotion | null;
  /** Лінія обраного маршруту дня — фон під точками */
  planned?: RouteLine;
  /** Активна навігація до однієї точки — малюється поверх усього */
  nav?: RouteLine;
  /** Тап «Навігація» в попапі точки */
  onNavigate?: (stopKey: string) => void;
  /** follow — камера їде за водієм; overview — водій крутить карту сам */
  mode?: MapMode;
  /** Карта сама просить вимкнути слідування, коли водій торкнувся екрана */
  onModeChange?: (mode: MapMode) => void;
  /** Показувати шар пробок (потрібен TOMTOM_API_KEY на сервері) */
  traffic?: boolean;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);

  const markersRef = useRef<maplibregl.Marker[]>([]);
  const meMarkerRef = useRef<maplibregl.Marker | null>(null);
  const arrowElRef = useRef<HTMLDivElement | null>(null);
  const fittedRef = useRef(false);

  /** Колбеки у ref, щоб зміна функції не перемальовувала карту. */
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onModeChangeRef = useRef(onModeChange);
  onModeChangeRef.current = onModeChange;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  /** Останній відлік GPS — таймер слідування читає його звідси. */
  const motionRef = useRef(motion);
  motionRef.current = motion;

  // Перемальовуємо точки лише коли змінився склад або статуси — трек
  // оновлюється щохвилини, і тягнути за собою маркери марно.
  const stopsKey = useMemo(
    () => stops.map((s) => `${s.key}:${statusOf(s)}`).join("|"),
    [stops]
  );

  /**
   * Рве трек там, де між точками діра.
   *
   * Планшет буває офлайн, і сусідні точки треку опиняються за кілометри
   * одна від одної. З'єднані лінією, вони малюють пряму через півміста —
   * «через дахи», якої водій не проїжджав. Дороги для таких розривів
   * добирає сервер (buildTrackPath), але коли OSRM не відповів, лишається
   * хорда. Її краще не малювати зовсім: розрив у лінії чесніший за
   * вигадану дорогу.
   */
  const splitTrail = useCallback((pts: Array<[number, number]>): Array<Array<[number, number]>> => {
    const R = 6_371_000;
    const rad = (d: number) => (d * Math.PI) / 180;
    const metersBetween = (a: [number, number], b: [number, number]) => {
      const dLat = rad(b[0] - a[0]);
      const dLng = rad(b[1] - a[1]);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    };

    // 700 м: далі за це сусідні точки не бувають при живому GPS —
    // проріджування пише точку щонайменше кожні 30 м руху.
    const GAP_M = 700;
    const out: Array<Array<[number, number]>> = [];
    let cur: Array<[number, number]> = [];

    for (let i = 0; i < pts.length; i++) {
      if (i > 0 && metersBetween(pts[i - 1], pts[i]) > GAP_M) {
        if (cur.length > 1) out.push(cur);
        cur = [];
      }
      cur.push(pts[i]);
    }
    if (cur.length > 1) out.push(cur);
    return out;
  }, []);

  /** Проста лінія: джерело створене на load, тут лише оновлюємо дані. */
  const setLine = useCallback((id: string, coords: Array<[number, number]> | null) => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords ?? [] },
    });
  }, []);

  // Ініціалізація карти. Один раз на весь час життя компонента.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [24.0297, 49.8397], // Львів
      zoom: 9,
      maxBounds: UA_BOUNDS,
      minZoom: 6,
      attributionControl: false,
      // Керування пальцями: зум щипком і поворот двома пальцями, але без
      // кнопок — на них не поцілиш на ходу.
      pitchWithRotate: true,
      dragRotate: true,
    });
    mapRef.current = map;

    // Атрибуція OSM обов'язкова за ліцензією, але на планшеті вона краде
    // місце — тому згорнута в «i».
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    map.on("load", () => {
      // Порядок додавання = порядок малювання: пробки під усім нашим,
      // далі план, трек і зверху активна навігація.
      map.addSource("traffic", {
        type: "raster",
        tiles: [`${window.location.origin}/api/traffic/{z}/{x}/{y}`],
        tileSize: 256,
        minzoom: 6,
        maxzoom: 18,
      });
      map.addLayer({
        id: "traffic",
        type: "raster",
        source: "traffic",
        layout: { visibility: "none" },
        paint: { "raster-opacity": 0.75 },
      });

      const emptyLine = {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates: [] as number[][] },
      };
      for (const id of ["planned", "trail", "nav"]) {
        map.addSource(id, { type: "geojson", data: emptyLine });
      }

      // Трек іде ПЕРШИМ, тобто під маршрутом: пройдене — довідка, а не
      // те, за чим їдуть. Сірий, щоб не сперечався з синьою дорогою.
      map.addLayer({
        id: "trail",
        type: "line",
        source: "trail",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#6B7280", "line-width": 4, "line-opacity": 0.55 },
      });

      // Маршрут — суцільна синя з темною облямівкою, як у будь-якому
      // навігаторі. Пунктир фіолетовим читався як «щось службове»:
      // водій хоче бачити дорогу, а не позначку на схемі.
      map.addLayer({
        id: "planned-casing",
        type: "line",
        source: "planned",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#1E40AF", "line-width": 11, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "planned",
        type: "line",
        source: "planned",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#3B82F6", "line-width": 7, "line-opacity": 1 },
      });

      // Активна навігація — помаранчева, з темною облямівкою, щоб
      // читалась і поверх пробок, і поверх плану.
      map.addLayer({
        id: "nav-casing",
        type: "line",
        source: "nav",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#7C2D12", "line-width": 10, "line-opacity": 0.5 },
      });
      map.addLayer({
        id: "nav",
        type: "line",
        source: "nav",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#F97316", "line-width": 6, "line-opacity": 0.95 },
      });

      setReady(true);
    });

    // Водій торкнувся карти — віддаємо керування йому. Слідування, яке
    // перебиває палець, дратує найбільше: людина тягне карту подивитись
    // наступну точку, а її щосекунди відкидає назад.
    // Тільки СПРАВЖНІЙ дотик, не наша ж анімація. easeTo теж шле
    // dragstart/rotatestart/pitchstart — без цієї перевірки слідування
    // вимикало саме себе на першому ж повороті камери за курсом, і карта
    // назавжди застигала на зумі тієї швидкості, з якою рушила.
    const release = (e: { originalEvent?: unknown }) => {
      if (!e?.originalEvent) return;
      if (modeRef.current === "follow") onModeChangeRef.current?.("overview");
    };
    map.on("dragstart", release);
    map.on("rotatestart", release);

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = [];
      meMarkerRef.current = null;
      arrowElRef.current = null;
      setReady(false);
    };
  }, []);

  // Точки маршруту. Маркер — DOM-елемент з номером просто на кружечку,
  // щоб порядок об'їзду читався без тапу по кожній.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const pts = spread(stops);
    const bounds = new maplibregl.LngLatBounds();

    pts.forEach((s) => {
      const color = STOP_COLOR[statusOf(s)];
      const el = document.createElement("div");
      el.style.cssText = `width:28px;height:28px;border-radius:50%;background:${color};
        border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);color:#fff;
        font:700 12px/23px system-ui;text-align:center;cursor:pointer`;
      el.textContent = String(s.sequence);

      const popup = new maplibregl.Popup({ offset: 18, maxWidth: "280px" }).setHTML(
        popupHtml(s)
      );
      // Попапи — рядки HTML, React-обробник туди не почепиш: ловимо тап
      // на відкритому попапі (той самий патерн, що в картах торгового).
      popup.on("open", () => {
        popup
          .getElement()
          ?.querySelectorAll<HTMLElement>("[data-nav]")
          .forEach((btn: HTMLElement) => {
            btn.onclick = () => {
              popup.remove();
              onNavigateRef.current?.(s.key);
            };
          });
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([s.lng, s.lat])
        .setPopup(popup)
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([s.lng, s.lat]);
    });

    // Підганяємо вікно один раз: далі камерою керує або водій, або
    // режим слідування.
    if (!fittedRef.current && pts.length > 0) {
      map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 600 });
      fittedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey, ready]);

  // Лінія плану дня.
  useEffect(() => {
    if (!ready) return;
    const coords = planned?.coordinates ?? null;
    setLine("planned", coords);
    // Показуємо план цілком, лише поки водій не поїхав: під час руху
    // камера належить режиму слідування.
    if (coords?.length && modeRef.current !== "follow") {
      const b = new maplibregl.LngLatBounds();
      coords.forEach((c) => b.extend(c));
      mapRef.current?.fitBounds(b, { padding: 48, maxZoom: 14, duration: 700 });
    }
  }, [planned, ready, setLine]);

  // Дорога до однієї точки: водій щойно попросив її — показуємо всю.
  useEffect(() => {
    if (!ready) return;
    const coords = nav?.coordinates ?? null;
    setLine("nav", coords);
    if (coords?.length && modeRef.current !== "follow") {
      const b = new maplibregl.LngLatBounds();
      coords.forEach((c) => b.extend(c));
      mapRef.current?.fitBounds(b, { padding: 60, maxZoom: 15, duration: 700 });
    }
  }, [nav, ready, setLine]);

  // Трек: GeoJSON у [lng, lat], а приходить [lat, lng]. Малюємо
  // шматками, щоб діри в записі не ставали прямими через квартали.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || trail.length < 2) return;
    const src = map.getSource("trail") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;

    const segments = splitTrail(trail).map((seg) =>
      seg.map(([lat, lng]) => [lng, lat] as [number, number])
    );
    src.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "MultiLineString", coordinates: segments },
    });
  }, [trail, ready, splitTrail]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty("traffic", "visibility", traffic ? "visible" : "none");
  }, [traffic, ready]);

  // Маркер водія: стрілка курсу в колі точності. Створюємо один раз,
  // далі лише рухаємо й крутимо — перестворення давало б блимання.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const pos =
      motion ?? (me ? { ...me, speedKmh: null, headingDeg: null, accuracyM: null } : null);
    if (!pos) {
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      arrowElRef.current = null;
      return;
    }

    if (!meMarkerRef.current) {
      const wrap = document.createElement("div");
      wrap.style.cssText =
        "width:34px;height:34px;display:flex;align-items:center;justify-content:center";

      // Пульсуючий ореол — «сигнал живий». Той самий прийом, що в
      // мобільних навігаторах: спокійний, не миготить.
      const halo = document.createElement("div");
      halo.style.cssText = `position:absolute;width:34px;height:34px;border-radius:50%;
        background:rgba(37,99,235,.22);animation:budvik-pulse 2s ease-out infinite`;
      wrap.appendChild(halo);

      // Стрілка, а не крапка: одразу видно, куди дивиться машина.
      const arrow = document.createElement("div");
      arrow.style.cssText = `position:relative;width:0;height:0;
        border-left:9px solid transparent;border-right:9px solid transparent;
        border-bottom:20px solid #2563EB;
        filter:drop-shadow(0 1px 3px rgba(0,0,0,.5));
        transition:transform .3s linear`;
      wrap.appendChild(arrow);
      arrowElRef.current = arrow;

      if (!document.getElementById("budvik-pulse-style")) {
        const style = document.createElement("style");
        style.id = "budvik-pulse-style";
        style.textContent =
          "@keyframes budvik-pulse{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.9);opacity:0}}";
        document.head.appendChild(style);
      }

      meMarkerRef.current = new maplibregl.Marker({ element: wrap })
        .setLngLat([pos.lng, pos.lat])
        .addTo(map);
    } else {
      meMarkerRef.current.setLngLat([pos.lng, pos.lat]);
    }

    // Коли карта повернута за курсом, стрілка має дивитись угору екрана,
    // тож віднімаємо поворот самої карти.
    const heading = pos.headingDeg ?? 0;
    const screenAngle = modeRef.current === "follow" ? 0 : heading - map.getBearing();
    if (arrowElRef.current) {
      arrowElRef.current.style.transform = `rotate(${screenAngle}deg)`;
    }
  }, [me, motion, ready]);

  /**
   * Слідування: камера їде за водієм.
   *
   * Камеру рухає власний таймер, а не ефект на зміну motion. Причина —
   * рівність за значенням: коли машина стоїть, GPS шле ту саму швидкість
   * і ті самі координати, React вважає стан незмінним і ефект не
   * запускає. Через це карта, розігнавшись до траси, лишалася на зумі
   * траси й після зупинки — «доїхати назад» до зуму 17 не було кому.
   *
   * Таймер читає останній motion з ref, тож бачить кожен відлік GPS.
   * Крок 700 мс — менший за інтервал GPS (секунда), щоб анімація
   * встигала завершитись і не переривалась на півдорозі.
   */
  useEffect(() => {
    if (!ready || mode !== "follow") return;

    const tick = () => {
      const map = mapRef.current;
      const m = motionRef.current;
      if (!map || !m) return;

      const speed = m.speedKmh;
      const moving = speed != null && speed >= 3;
      const targetZoom = zoomForSpeed(speed);
      const targetPitch = pitchForSpeed(speed);
      const targetBearing =
        moving && m.headingDeg != null ? m.headingDeg : map.getBearing();

      // Не смикаємо камеру, коли ціль практично досягнута: інакше карта
      // безперервно «догойдується» і не дає торкнутись екрана.
      const near =
        Math.abs(map.getZoom() - targetZoom) < 0.05 &&
        Math.abs(map.getPitch() - targetPitch) < 1 &&
        Math.abs(((map.getBearing() - targetBearing + 540) % 360) - 180) < 1 &&
        map.getCenter().distanceTo(new maplibregl.LngLat(m.lng, m.lat)) < 5;
      if (near) return;

      map.easeTo({
        center: [m.lng, m.lat],
        zoom: targetZoom,
        bearing: targetBearing,
        pitch: targetPitch,
        duration: 700,
        essential: true,
      });
      if (arrowElRef.current) arrowElRef.current.style.transform = "rotate(0deg)";
    };

    tick();
    const id = window.setInterval(tick, 700);
    return () => window.clearInterval(id);
  }, [mode, ready]);

  // Вихід зі слідування — повертаємо карту «північ угору» й прибираємо
  // нахил, інакше водій лишається з поверненою картою і не розуміє, як її
  // випрямити.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || mode !== "overview") return;
    if (map.getBearing() !== 0 || map.getPitch() !== 0) {
      map.easeTo({ bearing: 0, pitch: 0, duration: 500 });
    }
  }, [mode, ready]);

  return <div ref={containerRef} style={{ height, width: "100%" }} />;
}
