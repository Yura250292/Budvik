"use client";

/**
 * Маршрут зміни на карті: робочий трек, те, що було після неї, і план.
 *
 * Три сенси, три кольори. Синє — час, за який платять. Червоний пунктир —
 * поїздки після закриття зміни. Зелене — маршрут, який торговому
 * призначили: він лежить ПІД треком, бо це підкладка-лінійка, а не факт.
 * Злиті в одну лінію, вони давали б хибне враження довгого робочого дня.
 *
 * Робочий трек ще й поділений за способом пересування, і це не оформлення.
 * Власника цікавить швидке пересування — воно і є маршрут; а торговий
 * півдня ходить ногами по ринку, двору й складу клієнта. Намальовані тією
 * самою синьою лінією, ці метри й давали «хвости»: людина обійшла ринок, а
 * карта показала зигзаг через квартал. Тепер ходьба — тонкий бурштиновий
 * пунктир, а стоянка не малюється взагалі: людина нікуди не йшла, і
 * тремтіння приймача на місці не має вдавати шлях.
 *
 * Червоні кола — епізоди, коли трек надовго пішов за межі коридору
 * маршруту. Коло, а не маркер: епізод — це область і тривалість.
 *
 * Чорні нумеровані кружки — зупинки, і це головне на карті. Питання «де були
 * торгові» лінією відповідається погано за побудовою: між двома фіксами вона
 * мусить щось намалювати, і це завжди здогад — звідси й «хвости». Зупинка
 * здогадів не потребує: це місце, з якого людина не виходила, і час, який
 * вона там пробула. Режим «тільки зупинки» ховає лінію зовсім.
 */

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { FRAMED_MAP_OPTIONS, MapFrame, attachWheelGate, useWheelGate } from "./MapFrame";
import { escapeHtml, MOVE_COLOR, stopPin, stopTooltip, type TrackStopDot } from "./track-pins";

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

/**
 * Скільки хвилин точка ще означає «зараз».
 *
 * Те саме число, що й межа свіжості в діагнозі треку: точка пишеться раз на
 * хвилину, тож десять хвилин мовчання — це вже не «зараз».
 */
const LIVE_FRESH_MIN = 10;



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

export type { TrackStopDot };

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
  shiftParts = [],
  stops = [],
  onlyStops = false,
  afterShiftPath,
  planGeometry = null,
  planStops = [],
  excursions = [],
  orders = [],
  focusOrderId = null,
  base = null,
  live = false,
  lastPointAt = null,
  lastPointTime = null,
  fitKey = null,
  height = "420px",
}: {
  shiftPath: Array<[number, number]>;
  /**
   * Той самий трек, поділений на їзду, ходьбу й стоянки.
   *
   * Порожній масив — стара поведінка: суцільна синя лінія. Так карта
   * лишається робочою і там, куди поділ ще не довели.
   */
  shiftParts?: Array<{
    mode: "DRIVE" | "WALK" | "STOP";
    path: Array<[number, number]>;
    km: number;
    minutes: number;
    /** FIRST — уперше цією дорогою, BACK — назад по своєму сліду, AGAIN — удруге туди ж. */
    pass?: "FIRST" | "BACK" | "AGAIN";
    /** Планшет мовчав: пряма між точками — здогад, а не виміряний шлях. */
    unknown?: boolean;
    /** Шлях не ліг на жодну вулицю — причина інша, вигляд той самий. */
    offRoad?: boolean;
  }>;
  /** Де людина стояла довше кількох хвилин — головна відповідь на «де був». */
  stops?: TrackStopDot[];
  /**
   * Сховати лінію зовсім і лишити самі зупинки.
   *
   * Найчистіша відповідь на питання «де були торгові»: жодної інтерпольованої
   * геометрії, лише виміряні місця й час у них.
   */
  onlyStops?: boolean;
  afterShiftPath: Array<[number, number]>;
  /** GeoJSON LineString від OSRM; без неї пункти з'єднуються прямою */
  planGeometry?: { type?: string; coordinates?: [number, number][] } | null;
  planStops?: PlanStop[];
  excursions?: PlanExcursion[];
  /** Клієнти, від яких цього дня є замовлення. */
  orders?: OrderDot[];
  /** Клієнт зі списку поруч, на якому зараз тримають курсор. */
  focusOrderId?: string | null;
  /**
   * Зміна ще триває — тоді остання точка це не кінець маршруту.
   *
   * Без цього прапорця карта підписувала її «Кінець зміни» посеред робочого
   * дня, і виглядало це так, ніби людина вже закінчила. Насправді питання до
   * тієї точки інше: де він зараз або де його бачили востаннє.
   */
  live?: boolean;
  /** Час останньої точки: ISO для свіжості й готовий рядок для підпису. */
  lastPointAt?: string | null;
  lastPointTime?: string | null;
  /**
   * Що саме показуємо (id зміни). Межі карти підганяються лише коли це
   * значення змінилося.
   *
   * Потрібне через самооновлення відкритої зміни: без нього кожні шістдесят
   * секунд карта стрибала б назад на весь маршрут, і роздивитися щось
   * зблизька було б неможливо — рівно тоді, коли людина цього й хоче.
   */
  fitKey?: string | null;
  /** База торгового — точка відліку подачі */
  base?: { lat: number; lng: number; address: string | null } | null;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  /** Кільця замовлень за id клієнта — щоб список поруч міг їх підсвічувати. */
  /** Для якого саме об'єкта межі вже підганяли — див. fitKey. */
  const fittedRef = useRef<string | null | undefined>(undefined);
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
      if (onlyStops) {
        // Лінії немає, але межі карти тримає той самий трек: інакше день
        // із двома зупинками показував би пів області.
        shiftPath.forEach((c) => bounds.extend(c));
      } else if (shiftParts.length > 0) {
        for (const part of shiftParts) {
          if (part.path.length < 2) continue;
          /**
           * Стоянку не малюємо зовсім. За день її набігає по три-чотири
           * години, і весь цей час приймач тремтить на місці, вимальовуючи
           * клубки там, де людина просто стояла у клієнта.
           */
          if (part.mode === "STOP") continue;
          const walk = part.mode === "WALK";
          /**
           * Повернення по власному сліду — окремим кольором.
           *
           * Інакше його не видно взагалі: друга лінія лягає точно на першу, і
           * день із двома заїздами в те саме село виглядає як день з одним.
           * А це саме ті кілометри, які прибираються перекладанням порядку
           * точок у маршруті, — тобто єдині, з якими взагалі можна щось
           * зробити.
           */
          const repeat = !walk && part.pass && part.pass !== "FIRST";
          /**
           * Шлях невідомий — малюємо блідим пунктиром, а не суцільною лінією.
           *
           * Суцільна лінія крізь квартали читається як проїзд, якого ніхто не
           * бачив: планшет там мовчав. Підставити замість неї дорогу з OSRM
           * спокусливо й перевірено — на справжніх днях це роздуло пробіг
           * Передрія з 64 до 85 км при одометрі 69, бо маршрутизатор веде
           * СВОЇМ найкращим шляхом. Тому лишаємо пряму, але не вдаємо, що
           * це вимір.
           */
          const unknown = !walk && part.unknown;
          L.polyline(part.path, {
            color: unknown
              ? "#94A3B8"
              : walk
                ? "#D97706"
                : repeat
                  ? part.pass === "BACK"
                    ? MOVE_COLOR.BACK
                    : MOVE_COLOR.AGAIN
                  : "#2563EB",
            weight: unknown ? 3 : walk ? 3 : 4,
            opacity: unknown ? 0.75 : walk ? 0.9 : 0.85,
            ...(unknown ? { dashArray: "6 8", lineCap: "round" as const } : {}),
            ...(walk ? { dashArray: "2 6", lineCap: "round" as const } : {}),
          })
            .bindTooltip(
              unknown
                ? part.offRoad
                  ? `Дороги під цим слідом немає: ${part.km} км навпростець — шлях невідомий`
                  : `Дані не доїхали: ${part.minutes} хв тиші, пряма ${part.km} км — справжній шлях невідомий`
                : walk
                  ? `Пішки ${part.km} км, ${part.minutes} хв`
                  : repeat
                    ? `${part.pass === "BACK" ? "Назад тією самою дорогою" : "Той самий проїзд удруге"}` +
                      ` · ${part.km} км, ${part.minutes} хв`
                    : `Автом ${part.km} км, ${part.minutes} хв`,
              { sticky: true }
            )
            .addTo(group);
        }
      } else {
        L.polyline(shiftPath, { color: "#2563EB", weight: 4, opacity: 0.85 }).addTo(group);
      }
      shiftPath.forEach((c) => bounds.extend(c));

      // Початок і кінець робочої зміни — щоб було видно, з якого краю
      // читати лінію.
      L.circleMarker(shiftPath[0], {
        radius: 6, color: "#fff", weight: 2, fillColor: "#16A34A", fillOpacity: 1,
      })
        .bindTooltip("Початок зміни", { direction: "top" })
        .addTo(group);

      /**
       * Остання точка відкритої зміни — це «де він зараз», а не «кінець».
       *
       * Підпис тримаємо ПОСТІЙНО відкритим і показуємо час: у відкритій
       * зміні це найпотрібніше число на карті, і шукати його наведенням
       * миші людина не мусить. Свіжість вирішує формулювання: щойно
       * записана точка — «зараз тут», давніша — «востаннє тут», бо
       * стверджувати, що людина досі там, ми не можемо.
       */
      const lastAgoMin = lastPointAt
        ? Math.floor((Date.now() - new Date(lastPointAt).getTime()) / 60_000)
        : null;
      const fresh = lastAgoMin != null && lastAgoMin <= LIVE_FRESH_MIN;
      const label = !live
        ? "Кінець зміни"
        : fresh
          ? `Зараз тут${lastPointTime ? ` · ${lastPointTime}` : ""}`
          : `Востаннє тут${lastPointTime ? ` · ${lastPointTime}` : ""}` +
            (lastAgoMin != null ? ` (${lastAgoMin} хв тому)` : "");

      L.circleMarker(shiftPath[shiftPath.length - 1], {
        radius: live ? 8 : 6,
        color: "#fff",
        weight: live ? 3 : 2,
        // Жива точка синя, як і сам трек: червоний на карті вже означає
        // «після зміни», і другий сенс для того самого кольору тільки
        // заплутав би.
        fillColor: live ? (fresh ? "#2563EB" : "#D97706") : "#DC2626",
        fillOpacity: 1,
      })
        .bindTooltip(label, { direction: "top", permanent: live, opacity: 0.95 })
        .addTo(group);
    }

    if (afterShiftPath.length > 1 && !onlyStops) {
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
    /**
     * Зупинки — поверх лінії й під замовленнями.
     *
     * Порядок навмисний: лінія це шлях, зупинка це місце, замовлення це
     * результат. Читається згори вниз саме в такому порядку.
     */
    stops.forEach((stop) => {
      L.marker([stop.lat, stop.lng], { icon: stopPin(stop.seq, stop.minutes) })
        .bindTooltip(stopTooltip(stop), { direction: "top" })
        .addTo(group);
      bounds.extend([stop.lat, stop.lng]);
    });

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

    if (bounds.isValid() && fittedRef.current !== fitKey) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      fittedRef.current = fitKey;
    }
    // Живі поля обов'язково в залежностях: без них мітка «зараз тут» лишалася
    // б на місці першого малювання, тобто карта відкритої зміни брехала б
    // рівно про те, заради чого її відкривають.
  }, [shiftPath, shiftParts, stops, onlyStops, afterShiftPath, planGeometry, planStops, excursions, orders, base, live, lastPointAt, lastPointTime, fitKey]);

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
