"use client";

/**
 * Карта водія на Google Maps.
 *
 * Той самий екран, що й SalesClientsMap, але на картинці Google: водії
 * знають її напам'ять, а OpenStreetMap у селі під Львовом читають гірше —
 * інші підписи, інші відтінки, менше орієнтирів у приватному секторі.
 *
 * Інтерфейс збігається з нашою картою слово в слово, тож екран обирає
 * реалізацію одним рядком: є ключ — Google, немає — Leaflet. Це не
 * запобіжник, а робочий режим: без ключа все працює як раніше.
 *
 * Маркери класичні (`google.maps.Marker`), а не AdvancedMarkerElement.
 * Останні вимагають Map ID, створеного в консолі, — тобто ще один похід
 * власника в Google Cloud заради того самого квадратика з номером.
 * Класичний маркер малює SVG, і цього досить.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CLIENT_STATE } from "@/lib/analytics/colors";
import { loadGoogleMaps } from "@/lib/maps/google-loader";
import {
  PLAN_COLORS,
  planPopupHtml,
  popupHtml,
  spread,
  type DayPlan,
  type PopupExtras,
  type SalesClientPoint,
  type SalesMapAction,
} from "./SalesClientsMap";

/** Центр області, поки не приїхали точки. Той самий, що в нашій карті. */
const LVIV = { lat: 49.8397, lng: 24.0297 };

/**
 * Скільки кружечків малюємо за раз.
 *
 * Стеля на випадок, коли водій відтиснув карту на пів країни: у видиме
 * вікно потрапляє все, і ми знову впираємося в ті самі гальма. Триста —
 * межа, за якою кружечки однаково зливаються в пляму й нічого не кажуть.
 */
const MAX_CLIENTS = 300;

/**
 * Квадратик із номером — SVG у data-URI.
 *
 * Саме квадрат, а не крапля: круглі маркери зайняті клієнтами, і два
 * однакові за формою шари читалися б як одне скупчення.
 */
function planIcon(seq: number, label: string, bg: string, fg: string, current: boolean): google.maps.Icon {
  const size = current ? 38 : 30;
  const pad = (size - 30) / 2;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    (current
      ? `<rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="12" fill="#2563EB" opacity="0.25"/>`
      : "") +
    `<rect x="${pad + 1}" y="${pad + 1}" width="28" height="28" rx="9" fill="${bg}" stroke="#fff" stroke-width="2"/>` +
    `<text x="${size / 2}" y="${size / 2}" fill="${fg}" font-family="system-ui,sans-serif"` +
    ` font-size="13" font-weight="800" text-anchor="middle" dominant-baseline="central">${label}</text>` +
    `</svg>`;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2),
  };
}

export default function DriverGoogleMap({
  clients,
  plan = null,
  me,
  onAction,
  extras = {},
  focus = null,
}: {
  clients: SalesClientPoint[];
  /**
   * Напрямок торгового — у водія його не буває, тож тут не малюється.
   * Проп лишається в підписі, щоб обидві карти приймали однаковий набір і
   * екран міг вибрати одну з них без жодної умови в розмітці.
   */
  route?: unknown;
  plan?: DayPlan;
  me?: { lat: number; lng: number } | null;
  onAction?: (action: SalesMapAction) => void;
  extras?: PopupExtras;
  focus?: { lat: number; lng: number; id?: string; nonce: number } | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  /**
   * Клієнтські маркери живуть МІЖ перемальовками.
   *
   * Це і є ліки від гальм: раніше кожен рух карти зносив усі маркери й
   * створював їх наново, а створення маркера Google коштує на порядок
   * дорожче за його переміщення в інший шар. При звичайному перетягуванні
   * у вікні лишається більшість тих самих точок — тепер вони просто
   * лишаються, а міняється хвіст.
   */
  const clientMarkersRef = useRef(new Map<string, google.maps.Marker>());
  const planMarkersRef = useRef<google.maps.Marker[]>([]);
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const meRef = useRef<google.maps.Marker | null>(null);
  const byKeyRef = useRef(new Map<string, google.maps.Marker>());
  const fittedRef = useRef(false);
  const [ready, setReady] = useState(false);
  /**
   * Що зараз у вікні карти.
   *
   * Малювати всі 3094 клієнти Google не встигає: перемикання на «Всі»
   * коштувало сім секунд, і ще дві — кожне перетягування. Leaflet тягнув
   * це миттєво, бо його кружечок — простий SVG у спільному шарі, а в
   * Google кожен маркер це окремий обʼєкт із власними подіями.
   *
   * Тому клієнтів малюємо лише в межах видимого, з невеликим запасом.
   * Втрати немає: на віддаленні три тисячі крапок однаково зливаються в
   * пляму, а точки маршруту малюються завжди — їх десятки.
   */
  const [view, setView] = useState<google.maps.LatLngBoundsLiteral | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  /** Колбеки в рефах: інакше кожен рендер сторінки перемальовував би точки. */
  const actionRef = useRef(onAction);
  actionRef.current = onAction;
  const extrasRef = useRef(extras);
  extrasRef.current = extras;
  const focusRef = useRef(focus);
  focusRef.current = focus;

  /* --- створення карти --- */
  useEffect(() => {
    let alive = true;
    loadGoogleMaps()
      .then((maps) => {
        if (!alive || !boxRef.current || mapRef.current) return;
        mapRef.current = new maps.Map(boxRef.current, {
          center: LVIV,
          zoom: 9,
          // Керування прибрано: на планшеті зумлять пальцями, а кнопки
          // з'їдають ті самі кути, де в нас шапка й панель.
          disableDefaultUI: true,
          zoomControl: false,
          gestureHandling: "greedy",
          clickableIcons: false,
        });
        infoRef.current = new maps.InfoWindow();
        // idle, а не bounds_changed: перше спрацьовує раз після руху, друге —
        // на кожен кадр перетягування.
        mapRef.current.addListener("idle", () => {
          const b = mapRef.current?.getBounds();
          if (b) setView(b.toJSON());
        });
        setReady(true);
      })
      .catch((e) => alive && setFailed(e instanceof Error ? e.message : "Карта не завантажилась"));
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Ключ перемальовки — той самий, що в нашій карті: склад точок, їхній
   * стан і номери. Без нього кожен рендер сторінки знімав би й ставив
   * заново сотні маркерів.
   */
  const clientsKey = useMemo(
    () =>
      clients
        .map(
          (c) =>
            `${c.id}:${c.state}:${c.mine ? 1 : 0}:${c.notes ?? 0}:` +
            `${c.lat.toFixed(5)},${c.lng.toFixed(5)}:${c.approximate ? 1 : 0}`
        )
        .join("|"),
    [clients]
  );

  const planKey = useMemo(
    () => plan?.stops.map((s) => `${s.key}:${s.status}:${s.seq}:${s.current ? 1 : 0}`).join(",") ?? "",
    [plan]
  );

  /**
   * Вікно в ключі — округлене до сотих градуса (~1 км).
   *
   * Дрібне посмикування карти не має чіпати шар зовсім, а перехід між
   * містами — має.
   */
  const viewKey = view
    ? [view.north, view.south, view.east, view.west].map((v) => v.toFixed(2)).join(",")
    : "";

  const openInfo = useCallback((marker: google.maps.Marker, html: string) => {
    const map = mapRef.current;
    const info = infoRef.current;
    if (!map || !info) return;
    info.setContent(html);
    info.open({ map, anchor: marker });
  }, []);

  /* --- шар клієнтів: переставляємо різницю, а не все --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

    /**
     * Запас у чверть висоти вікна: точка, до якої водій ось-ось доїде, має
     * вже бути намальована, а не зʼявлятися ривком на краю.
     */
    const inView = view
      ? (() => {
          const padLat = (view.north - view.south) * 0.25;
          const padLng = (view.east - view.west) * 0.25;
          return clients.filter(
            (c) =>
              c.lat >= view.south - padLat &&
              c.lat <= view.north + padLat &&
              c.lng >= view.west - padLng &&
              c.lng <= view.east + padLng
          );
        })()
      : clients;

    const wanted = spread(inView.slice(0, MAX_CLIENTS));
    const wantedIds = new Set(wanted.map((c) => c.id));
    const live = clientMarkersRef.current;

    // Зайве прибираємо…
    for (const [id, marker] of live) {
      if (!wantedIds.has(id)) {
        marker.setMap(null);
        live.delete(id);
      }
    }

    // …а бракуюче створюємо. Ті, що лишилися у вікні, не чіпаємо взагалі.
    for (const c of wanted) {
      if (live.has(c.id)) continue;
      const foreign = c.mine === false;
      const marker = new google.maps.Marker({
        position: { lat: c.lat, lng: c.lng },
        map,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: foreign ? 6 : 9,
          fillColor: CLIENT_STATE[c.state].color,
          fillOpacity: foreign ? 0.45 : 0.92,
          strokeColor: "#fff",
          strokeWeight: foreign ? 1 : 2,
        },
        zIndex: foreign ? 1 : 2,
        /**
         * Явно просимо швидкий шлях.
         *
         * З `optimized` Google зводить маркери в одне полотно замість
         * окремих вузлів DOM — для сотень кружечків це різниця в рази.
         * Автоматично він його вмикає не завжди, а нам тут нічого не
         * потрібно з того, що оптимізація забирає (ні анімації, ні
         * доступності на самому кружечку).
         */
        optimized: true,
      });
      marker.addListener("click", () => openInfo(marker, popupHtml(c, extrasRef.current)));
      live.set(c.id, marker);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientsKey, viewKey, ready]);

  /* --- шар маршруту: лінія й номерні піни --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;

    planMarkersRef.current.forEach((m) => m.setMap(null));
    planMarkersRef.current = [];
    lineRef.current?.setMap(null);
    lineRef.current = null;

    const bounds = new google.maps.LatLngBounds();

    // Лінія — під точками: вона фон, а не головне.
    if (plan?.geometry?.coordinates?.length) {
      lineRef.current = new google.maps.Polyline({
        path: plan.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
        strokeColor: "#2563EB",
        strokeOpacity: 0.55,
        strokeWeight: 5,
        map,
      });
      plan.geometry.coordinates.forEach(([lng, lat]) => bounds.extend({ lat, lng }));
    }

    // Поточна ціль малюється останньою — щоб не ховалася під сусідами.
    const pins = spread(plan?.stops ?? []).sort(
      (a, b) => Number(!!a.current) - Number(!!b.current)
    );
    pins.forEach((s) => {
      const { bg, fg } = PLAN_COLORS[s.status];
      const marker = new google.maps.Marker({
        position: { lat: s.lat, lng: s.lng },
        map,
        icon: planIcon(
          s.seq,
          s.errand ? "+" : String(s.seq),
          s.current ? "#2563EB" : bg,
          s.current ? "#fff" : fg,
          !!s.current
        ),
        zIndex: s.current ? 1000 : 900,
      });
      marker.addListener("click", () => openInfo(marker, planPopupHtml(s)));
      planMarkersRef.current.push(marker);
      byKeyRef.current.set(s.key, marker);
      bounds.extend({ lat: s.lat, lng: s.lng });
    });

    // Перше вікно ставить маршрут, якщо він є, — і лише один раз.
    if (!fittedRef.current && !bounds.isEmpty() && !focusRef.current) {
      map.fitBounds(bounds, 40);
      fittedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, ready]);

  /* --- кнопки в підказці. Ті самі рядки HTML, що в нашій карті --- */
  useEffect(() => {
    const info = infoRef.current;
    if (!ready || !info) return;
    const listener = info.addListener("domready", () => {
      document.querySelectorAll<HTMLElement>(".gm-style-iw [data-action]").forEach((btn) => {
        btn.onclick = () => {
          const kind = btn.dataset.action as SalesMapAction["kind"];
          const id = btn.dataset.id;
          if (!kind || !id) return;
          info.close();
          actionRef.current?.({ kind, id });
        };
      });
    });
    return () => listener.remove();
  }, [ready]);

  /* --- своя позиція окремим шаром: оновлюється частіше за точки --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (!me) {
      meRef.current?.setMap(null);
      meRef.current = null;
      return;
    }
    if (meRef.current) {
      meRef.current.setPosition(me);
      return;
    }
    meRef.current = new google.maps.Marker({
      position: me,
      map,
      title: "Ви тут",
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: "#2563EB",
        fillOpacity: 1,
        strokeColor: "#fff",
        strokeWeight: 3,
      },
      zIndex: 1100,
    });
  }, [me, ready]);

  /* --- політ до потрібної точки --- */
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus) return;
    map.panTo({ lat: focus.lat, lng: focus.lng });
    map.setZoom(Math.max(map.getZoom() ?? 9, 15));
    fittedRef.current = true;
    if (focus.id) {
      const marker = byKeyRef.current.get(focus.id) ?? clientMarkersRef.current.get(focus.id);
      const stop = plan?.stops.find((s) => s.key === focus.id);
      const client = clients.find((c) => c.id === focus.id);
      if (marker && stop) openInfo(marker, planPopupHtml(stop));
      else if (marker && client) openInfo(marker, popupHtml(client, extrasRef.current));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, ready]);

  if (failed) {
    return (
      <div
        className="flex h-full w-full items-center justify-center p-4 text-center"
        style={{ background: "#E5E7EB" }}
      >
        <p style={{ fontSize: "13px", color: "#6B7280", lineHeight: 1.5 }}>
          Карта Google не завантажилась ({failed}). Перезавантажте сторінку — маршрут і відмітки від
          цього не залежать.
        </p>
      </div>
    );
  }

  return <div ref={boxRef} style={{ height: "100%", width: "100%", background: "#E5E7EB" }} />;
}
