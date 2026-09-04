"use client";

/**
 * Карта клієнтів торгового: хто поруч, до кого сьогодні, хто вже мовчить.
 *
 * Окремо від адмінського ClientMap: там фільтри, легенда-чекбокси, режими
 * додавання точок і перенесення пінів — усе під мишу й великий екран. Тут
 * телефон у машині: тап по точці одразу веде в картку клієнта, зайвого
 * керування немає, а маркери більші, бо в них цілять пальцем.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CLIENT_STATE } from "@/lib/analytics/colors";
import { clampToUkraine } from "@/components/map/MapFrame";
import { planCore } from "@/lib/maps/plan-core";

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
  /**
   * Фото точки: як виглядає вхід, з якого боку заїзд.
   *
   * Показуємо просто в попапі, а не за кнопкою: водій під'їхав і мусить
   * упізнати місце за секунду, а не гортати стрічку нотаток.
   */
  photoUrl?: string | null;
  /**
   * Це фото САМОГО магазину, а не запасний кадр зі стрічки нотаток.
   *
   * Підпис від цього різний, і різниця не косметична: «так виглядає
   * магазин» — обіцянка, на яку можна покластися, під'їжджаючи, а
   * «останнє фото з нотаток» цілком може виявитись піддоном чи накладною.
   */
  photoIsShop?: boolean;
  /** Скільки нотаток про цю точку — щоб було видно, що є що читати. */
  notes?: number;
};

export type SalesRoute = {
  name: string;
  color: string | null;
  totalDistanceKm: number | null;
  geometry: { type: string; coordinates: [number, number][] } | null;
  stops: Array<{ settlement: string; lat: number; lng: number; seq: number }>;
} | null;

/**
 * Маршрутний лист, розкладений на карті.
 *
 * Окремо від `route` вище, і не косметично: там напрямок торгового —
 * ланцюжок населених пунктів без сум і без стану. Тут документ доставки,
 * у якого кожна точка має номер у черзі, гроші й відмітку. Малювати їх
 * однаково означало б втратити саме те, заради чого водій маршрут і
 * відкриває: у якому порядку їхати і де він уже був.
 */
export type PlanStop = {
  key: string;
  seq: number;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  amount: number;
  debt: number;
  /** DONE / MISSED — відмітка вже стоїть; PENDING — ще їхати */
  status: "DONE" | "MISSED" | "PENDING";
  /** Бонусна поїздка (забрати товар, пошта) — без товару й без інкасації */
  errand: boolean;
  /** Дорога до цієї точки в Google Maps */
  mapUrl: string | null;
  /**
   * До цієї точки водій їде просто зараз.
   *
   * Рівно одна на маршрут. Пульсує кільцем — серед тридцяти однакових
   * квадратів «наступна» інакше не знаходиться поглядом за кермом.
   */
  current?: boolean;
};

export type DayPlan = {
  number: string | null;
  geometry: { type: string; coordinates: [number, number][] } | null;
  stops: PlanStop[];
} | null;

/** Колір номерного піна за станом точки. */
export const PLAN_COLORS: Record<PlanStop["status"], { bg: string; fg: string }> = {
  DONE: { bg: "#16A34A", fg: "#fff" },
  MISSED: { bg: "#DC2626", fg: "#fff" },
  PENDING: { bg: "#0A0A0A", fg: "#FFD600" },
};

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });

/** Розводить точки, що впали в одні координати (геокод до міста). */
export function spread<T extends { lat: number; lng: number }>(points: T[]): T[] {
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

/**
 * Номерний пін точки маршруту.
 *
 * Квадрат, а не коло: круглі маркери на цій карті вже зайняті клієнтами, і
 * два кола різного змісту поруч читаються як одне скупчення. Квадрат із
 * номером видно як «черга», навіть не читаючи легенди.
 */
function planIcon(stop: PlanStop): L.DivIcon {
  const { bg, fg } = PLAN_COLORS[stop.status];
  const label = stop.errand ? "+" : String(stop.seq);
  // Поточна ціль — синя, як і дорога до неї, і з пульсуючим кільцем під піном.
  const bgNow = stop.current ? "#2563EB" : bg;
  const fgNow = stop.current ? "#fff" : fg;

  return L.divIcon({
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
    html: `<div style="position:relative;width:30px;height:30px">
      ${stop.current ? `<span class="driver-target-ring"></span>` : ""}
      <div style="
        position:relative;width:30px;height:30px;border-radius:9px;
        background:${bgNow};color:${fgNow};
        display:flex;align-items:center;justify-content:center;
        font-weight:800;font-size:13px;font-family:system-ui,sans-serif;
        border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.35)
      ">${escapeHtml(label)}</div>
    </div>`,
  });
}

const PLAN_STATUS_LABEL: Record<PlanStop["status"], string> = {
  DONE: "Відмічено",
  MISSED: "Не потрапив",
  PENDING: "Ще їхати",
};

export function planPopupHtml(stop: PlanStop): string {
  const { bg } = PLAN_COLORS[stop.status];
  const money_ =
    stop.amount > 0
      ? `<div style="color:#0A0A0A;font-weight:600">Накладна ${escapeHtml(money.format(stop.amount))} грн</div>`
      : "";
  const debt =
    stop.debt > 0
      ? `<div style="color:#D97706">Забрати борг ${escapeHtml(money.format(stop.debt))} грн</div>`
      : "";
  const road = stop.mapUrl
    ? `<a href="${escapeHtml(stop.mapUrl)}" target="_blank" rel="noopener"
         style="display:block;margin-top:6px;padding:9px;text-align:center;
         background:#2563EB;color:#fff;border-radius:8px;text-decoration:none;
         font-weight:700;font-size:13px">Дорога сюди</a>`
    : "";

  return `<div style="font-family:system-ui;font-size:14px;min-width:190px;max-width:250px">
    <span style="display:inline-block;margin-bottom:4px;padding:2px 8px;border-radius:10px;
      background:${bg};color:#fff;font-size:11px;font-weight:700">
      ${stop.current ? "Їдете сюди" : stop.errand ? "Додаткова поїздка" : `Точка ${stop.seq}`} · ${escapeHtml(PLAN_STATUS_LABEL[stop.status])}
    </span>
    <strong style="display:block;font-size:15px">${escapeHtml(stop.name)}</strong>
    ${stop.address ? `<div style="color:#6B7280;font-size:12px;margin-top:2px">${escapeHtml(stop.address)}</div>` : ""}
    ${money_}
    ${debt}
    ${road}
  </div>`;
}

export function popupHtml(c: SalesClientPoint, extras: PopupExtras): string {
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

  // Фото — одразу під назвою: це найшвидша відповідь на «я туди приїхав?».
  const photo = c.photoUrl
    ? `<a href="${escapeHtml(c.photoUrl)}" target="_blank" rel="noreferrer"
         style="display:block;margin:6px 0 2px">
         <img src="${escapeHtml(c.photoUrl)}" alt="${c.photoIsShop ? "Фото магазину" : "Фото з нотаток"}" loading="lazy"
           style="width:100%;height:110px;object-fit:cover;border-radius:8px"/>
         <span style="display:block;font-size:11px;color:${c.photoIsShop ? "#059669" : "#9CA3AF"};margin-top:2px">
           ${c.photoIsShop ? "Так виглядає магазин" : "Кадр із нотаток — не фото магазину"}
         </span>
       </a>`
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
    ${photo}
    ${popupButton("orderCard", c.id, "Що брав і що везти", true)}
    ${
      extras.comments
        ? popupButton(
            "comments",
            c.id,
            c.notes ? `Нотатки і фото (${c.notes})` : "Нотатка або фото",
            false
          )
        : ""
    }
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
  plan = null,
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
  /** Відкритий маршрутний лист: номерні піни, лінія плану, стан точок. */
  plan?: DayPlan;
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
  /**
   * id → маркер: пошук має не лише підлетіти, а й розкрити потрібну точку.
   * Тут же живуть номерні піни маршруту під своїми ключами (`ds:`/`rs:`) —
   * тап по рядку в списку точок мусить розкривати саме той пін.
   */
  const markersRef = useRef(new Map<string, L.Marker | L.CircleMarker>());
  /** Колбек у ref: інакше кожен новий рендер сторінки перемальовував би точки. */
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  /** Теж у ref: `extras` — літерал, новий на кожен рендер сторінки. */
  const extrasRef = useRef(extras);
  extrasRef.current = extras;
  /** Ключ точки, попап якої треба розкрити, щойно її маркер буде на карті. */
  const pendingPopupRef = useRef<string | null>(null);
  const openPending = useCallback(() => {
    const key = pendingPopupRef.current;
    if (!key) return;
    /*
      Ключ НЕ забуваємо після відкриття.
      Перемальовка шару знімає маркери з карти разом із відкритим попапом,
      а вона приходить щоразу, коли доїжджає лінія маршруту чи міняється
      відмітка. Забувши ключ, ми відкрили б попап рівно один раз — і його
      тут-таки й прибрало б. Ключ живе, поки водій не попросить іншу точку.
    */
    markersRef.current.get(key)?.openPopup();
  }, []);

  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;
  const pinningRef = useRef(pinning);
  pinningRef.current = pinning;

  const key = useMemo(
    () =>
      clients
        .map(
          (c) =>
            // notes у ключі: щойно доданий коментар чи фото мусять з'явитися
            // в попапі, а він перемальовується лише разом із маркерами.
            //
            // Координати й `approximate` — теж, і це не дрібниця. Без них
            // «Уточнити точку → Я зараз тут» виглядало як несправність:
            // сервер пін зберігав, дані в пам'яті оновлювались, а ключ
            // лишався той самий — тож маркер не перемальовувався. Точка
            // стояла на старому місці й далі підписувалась «приблизна».
            // Помітно це було лише на клієнтові, який на карті ВЖЕ є: тому,
            // кого там не було, `id` з'являвся у списку вперше, ключ від
            // цього мінявся, і той шлях працював.
            //
            // toFixed(5) — приблизно метр: точніше за будь-який GPS
            // телефона, а ключ не роздувається хвостом float.
            // Фото теж у ключі, і з тієї ж причини, що координати: щойно
            // знятий фасад мусить зʼявитися в попапі одразу. Хвіст адреси
            // містить мітку часу, тож заміна одного фото на інше ключ
            // теж змінює — а сама адреса в ключ не лізе, він і так довгий.
            `${c.id}:${c.state}:${c.mine ? 1 : 0}:${c.notes ?? 0}:` +
            `${c.lat.toFixed(5)},${c.lng.toFixed(5)}:${c.approximate ? 1 : 0}:` +
            `${c.photoUrl ? c.photoUrl.slice(-14) : ""}:${c.photoIsShop ? 1 : 0}`
        )
        .join("|") +
      "#" +
      (route?.name ?? "") +
      (route?.stops.length ?? 0) +
      // Лист теж у ключі: відкрили інший маршрут — піни мусять
      // перемалюватися, а відмітка точки одразу перефарбувати номер.
      "#" +
      (plan?.number ?? "") +
      plan?.stops.map((s) => `${s.key}:${s.status}:${s.seq}:${s.current ? 1 : 0}`).join(",") ,
    [clients, route, plan]
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

    /**
     * Лінія плану під точками, номери — поверх усього.
     *
     * Порядок саме такий: маршрут це фон, по якому їдуть, а номерні піни —
     * те, що водій шукає очима. Клієнтські кола малюються між ними, тож
     * номер ніколи не ховається під сусіднім магазином.
     */
    if (plan?.geometry?.coordinates?.length) {
      const line = plan.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]);
      L.polyline(line, { color: "#2563EB", weight: 5, opacity: 0.55 }).addTo(group);
      line.forEach((c) => bounds.extend(c));
    }

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

    /**
     * Номерні піни теж розводимо.
     *
     * У містечку на кшталт Новояворівська п'ять точок стоять в одному
     * кварталі, а частина взагалі має однакові координати (геокод до
     * вулиці). Без розведення видно один квадрат, і водій рахує, що точок
     * менше, ніж є. Зсув — метрів тридцять; дорога від цього не міняється,
     * бо посилання в попапі несе СПРАВЖНЮ координату точки, а не зсунуту.
     */
    const planPins = spread(plan?.stops ?? []).sort(
      (a, b) => Number(!!a.current) - Number(!!b.current)
    );
    planPins.forEach((stop) => {
      const marker = L.marker([stop.lat, stop.lng], { icon: planIcon(stop), zIndexOffset: 1000 })
        .bindPopup(planPopupHtml(stop), { minWidth: 190 })
        .addTo(group);
      markersRef.current.set(stop.key, marker);
      bounds.extend([stop.lat, stop.lng]);
    });

    /**
     * Загальне вікно ставимо, лише коли маршруту немає.
     *
     * Інакше два fitBounds їдуть майже одночасно — цей і той, що нижче
     * ставить вікно по маршруту, — і Leaflet другий просто ковтає:
     * анімація першого ще йде, і setView під час неї не застосовується.
     * Хто виграє, залежало від того, чия відповідь приїхала першою, тож
     * водій то бачив свій маршрут, то всю Україну. Вікно маршруту
     * головніше, і власник у нього один.
     */
    // Перемальовка могла статися ПІСЛЯ польоту — тоді попап чекає тут.
    openPending();

    if (!fittedRef.current && bounds.isValid() && !plan) {
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

  /**
   * Відкрили маршрут — карта показує саме його.
   *
   * Окремо від загального fitBounds, який спрацьовує один раз при першому
   * завантаженні. Без цього водій, обравши позавчорашній лист по сусідній
   * області, лишався б дивитися на порожній шматок карти й вирішив би, що
   * маршрут не завантажився.
   *
   * Ключ ефекту — склад точок, а не сам об'єкт: перемальовка після
   * відмітки візиту не має смикати вікно карти.
   */
  const planKey = plan?.stops.map((s) => s.key).join(",") ?? "";
  /** Реф, а не залежність: інакше кожен тап по рядку перефітив би маршрут. */
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !plan || plan.stops.length === 0) return;
    /*
      Просили конкретну точку — вікно ставить вона.
      Два рухи карти в одному такті Leaflet зливає в один: поки анімація
      fitBounds іде, flyTo не застосовується. Саме через це перехід «на
      карті» з рядка дня відлітав кудись у центр маршруту й не розкривав
      потрібного піна.
    */
    if (focusRef.current) return;
    const core = planCore(plan.stops);
    const bounds = L.latLngBounds(core.map((s) => [s.lat, s.lng] as [number, number]));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    // Перше вікно вже показане маршрутом — загальний fitBounds більше не потрібен.
    fittedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  // Політ до знайденого пошуком клієнта.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 15), { duration: 0.7 });
    /**
     * Попап відкриваємо ПІСЛЯ польоту й по свіжому маркеру.
     *
     * Двічі наступив на те саме: маркер, схоплений тут, живе рівно до
     * наступної перемальовки шару, а вона приходить за секунду — щойно
     * доїде лінія маршруту. Виклик `openPopup()` на знятому з карти
     * маркері мовчки не робить нічого, і виглядало це як «карта прилетіла,
     * а точка не розкрилася».
     *
     * Тому запамʼятовуємо лише КЛЮЧ, а маркер шукаємо в мить відкриття —
     * і те саме робить кінець малювання шару, якщо перемальовка встигла
     * раніше за політ.
     */
    if (focus.id) {
      pendingPopupRef.current = focus.id;
      map.once("moveend", () => openPending());
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
