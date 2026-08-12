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
  /**
   * Кільця межі зони: перше — зовнішній контур, решта можуть бути дірками
   * між гілками маршруту. Кожне кільце — замкнений список [lat, lng].
   */
  rings: Array<Array<[number, number]>>;
  points: ZonePoint[];
  /** Межу правили руками — показуємо це на карті, бо цифри вже не «як порахувалось» */
  edited?: boolean;
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

/**
 * Колір межі зони. Темна бірюза свідомо не збігається з жодним кольором
 * станів клієнтів і з жовтим брендом: межа — це не дані й не орган
 * керування, тож вона не мусить конкурувати ні з тим, ні з тим.
 * Контраст 4.6:1 на світлій підкладці мапи.
 */
const ZONE_ACCENT = "#0B7285";

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
  zoneEditing = false,
  onZoneEdit,
}: {
  routes: OverviewRoute[];
  legend?: LegendEntry[];
  height?: string;
  zone?: ZoneOverlay | null;
  /** Клієнти зі станами — той самий набір, що на «Карті клієнтів» */
  clients?: MapClientPoint[];
  onZonePointClick?: (id: string) => void;
  /** Режим правки межі: на вершинах з'являються ручки для перетягування */
  zoneEditing?: boolean;
  /** Межу змінили мишею — батько зберігає її на сервері */
  onZoneEdit?: (rings: Array<Array<[number, number]>>) => void;
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

  /** Шар ручок правки — окремо від самої межі, щоб не перемальовувати її на кожен драг. */
  const handlesRef = useRef<L.LayerGroup | null>(null);
  /** Робоча копія кілець під час правки: мутується драгом, потім віддається батькові. */
  const draftRef = useRef<Array<Array<[number, number]>>>([]);

  // Обробники в ref: інакше зміна колбека з боку батька перемальовувала б
  // усі точки зони, хоч самі точки ті самі.
  const clickRef = useRef(onZonePointClick);
  clickRef.current = onZonePointClick;
  const editRef = useRef(onZoneEdit);
  editRef.current = onZoneEdit;

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
    const shape = zone.rings.map((r) => r.length).join(",");
    return `${shape}:${zone.points.length}:${zone.edited ? "e" : ""}`;
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
      // Ручки правки — найвище: у них треба влучати мишею поверх усього.
      handlesRef.current = L.layerGroup().addTo(mapRef.current);

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

    if (zone.rings.length > 0) {
      // Заливка і межа — РІЗНІ шари. Один полігон із товстим пунктиром давав
      // би обведення й навколо дірок, і по внутрішніх краях; тут заливка
      // мовчазна, а межу малює окрема лінія поверх неї.
      L.polygon(zone.rings, {
        // fillRule nonzero: кільця від union приходять із правильною
        // орієнтацією, і дірки лишаються дірками, а гілки не гасять одна одну.
        fillRule: "nonzero",
        color: "transparent",
        weight: 0,
        fillColor: ZONE_ACCENT,
        fillOpacity: 0.1,
        interactive: false, // заливка не мусить перехоплювати кліки по пінах
      }).addTo(group);

      // У режимі правки межу малює шар ручок (він тримає робочу копію
      // кілець і рухає лінію за курсором) — тут її пропускаємо, інакше
      // під зміненою межею проступала б стара.
      if (!zoneEditing) zone.rings.forEach((ring) => {
        // Підкладка суцільною лінією: на строкатій мапі самий пунктир
        // губиться серед доріг, а так межа читається як межа.
        L.polyline([...ring, ring[0]], {
          color: ZONE_ACCENT,
          weight: 3,
          opacity: 0.25,
          interactive: false,
        }).addTo(group);

        // Власне «кордон»: пунктир, який повзе вздовж межі.
        L.polyline([...ring, ring[0]], {
          color: ZONE_ACCENT,
          weight: 2.5,
          opacity: 0.95,
          dashArray: "10 8",
          className: zoneEditing ? "zone-border zone-border--editing" : "zone-border",
          interactive: false,
        }).addTo(group);
      });
    }

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
    // zoneEditing тут теж потрібен: у режимі правки цей шар віддає малювання
    // межі шару ручок, і перемикання мусить його перебудувати.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneKey, zoneEditing]);

  /**
   * Ручки правки межі.
   *
   * Ручка ставиться не на кожну вершину: у контуру їх 300+, і суцільна
   * стіна кружечків не дає ні побачити межу, ні влучити в потрібну.
   * Беремо кожну N-ту так, щоб вийшло ~40 ручок — приблизно одна на
   * 20-30 px на типовому зумі, у це вже можна цілитись пальцем.
   *
   * Сусідні вершини між ручками їдуть за нею з загасанням: інакше
   * перетягування однієї точки давало б гострий шпичак замість плавного
   * зсуву ділянки межі. Це поведінка «магніта», а не «вузла».
   */
  useEffect(() => {
    const group = handlesRef.current;
    if (!group) return;

    group.clearLayers();
    if (!zoneEditing || !zone?.rings.length) return;

    draftRef.current = zone.rings.map((ring) => ring.map((p) => [...p] as [number, number]));

    const polylines: L.Polyline[] = [];
    draftRef.current.forEach((ring) => {
      polylines.push(
        L.polyline([...ring, ring[0]], {
          color: ZONE_ACCENT,
          weight: 2.5,
          opacity: 0.95,
          dashArray: "10 8",
          className: "zone-border zone-border--editing",
          interactive: false,
        }).addTo(group)
      );
    });

    draftRef.current.forEach((ring, ringIdx) => {
      const step = Math.max(1, Math.round(ring.length / 40));
      /** Скільки сусідів тягнеться за ручкою — половина кроку в кожен бік. */
      const pull = Math.max(1, Math.floor(step / 2) + 1);

      for (let i = 0; i < ring.length; i += step) {
        const handle = L.circleMarker(ring[i], {
          radius: 6,
          color: "#ffffff",
          weight: 2,
          fillColor: ZONE_ACCENT,
          fillOpacity: 1,
          // Курсор-хапалка: інакше не видно, що кружечок можна тягнути.
          className: "zone-handle",
          bubblingMouseEvents: false,
        }).addTo(group);

        const anchor = i;
        let dragging = false;

        const move = (e: L.LeafletMouseEvent) => {
          if (!dragging) return;
          const next: [number, number] = [e.latlng.lat, e.latlng.lng];
          const from = ring[anchor];
          const dLat = next[0] - from[0];
          const dLng = next[1] - from[1];

          ring[anchor] = next;
          // Сусіди їдуть слабше, чим далі вони від ручки.
          for (let k = 1; k <= pull; k++) {
            const w = 1 - k / (pull + 1);
            for (const j of [anchor - k, anchor + k]) {
              const idx2 = (j + ring.length) % ring.length;
              ring[idx2] = [ring[idx2][0] + dLat * w, ring[idx2][1] + dLng * w];
            }
          }

          handle.setLatLng(next);
          polylines[ringIdx].setLatLngs([...ring, ring[0]]);
        };

        const stop = () => {
          if (!dragging) return;
          dragging = false;
          mapRef.current?.dragging.enable();
          mapRef.current?.off("mousemove", move);
          mapRef.current?.off("mouseup", stop);
          // Віддаємо результат лише на відпускання: зберігати на кожен
          // піксель руху означало б сотні запитів за один драг.
          editRef.current?.(draftRef.current.map((r) => r.map((p) => [...p] as [number, number])));
        };

        handle.on("mousedown", () => {
          dragging = true;
          // Інакше карта поїде разом із ручкою.
          mapRef.current?.dragging.disable();
          mapRef.current?.on("mousemove", move);
          mapRef.current?.on("mouseup", stop);
        });
      }
    });
    // Перемальовуємо за змістовим ключем — див. коментар до routesKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneKey, zoneEditing]);

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
      handlesRef.current = null;
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
