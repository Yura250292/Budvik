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
import { clusterPins } from "@/lib/maps/pin-clusters";
import {
  clusterPopupHtml,
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
 * Значок точки маршруту — SVG у data-URI.
 *
 * Саме прямокутник, а не крапля: круглі маркери зайняті клієнтами, і два
 * однакові за формою шари читалися б як одне скупчення.
 *
 * Ширина рахується з напису, бо написи бувають різні: «7», «12», «4–6».
 * Раніше квадрат був сталий 28 пікселів, і двозначні номери в ньому
 * тиснулися до країв, а діапазон не вліз би взагалі.
 *
 * Розміри підняті проти початкових (28 → 34, шрифт 13 → 15): цю карту
 * читають з витягнутої руки, у тримачі на панелі, часто на сонці.
 */
function planIcon(label: string, bg: string, fg: string, current: boolean): google.maps.Icon {
  const h = 34;
  // 15px напівжирного — приблизно 9,5 пікселя на знак; плюс поля.
  const w = Math.max(h, Math.round(label.length * 9.5) + 20);
  const halo = current ? 6 : 0;
  const width = w + halo * 2;
  const height = h + halo * 2;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    (current
      ? `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="14" fill="#2563EB" opacity="0.22"/>`
      : "") +
    // Тінь окремим прямокутником, а не фільтром: SVG-фільтри в data-URI
    // Google подекуди не малює зовсім, і значок лишався б без відриву від
    // карти — саме того відриву, якого бракувало на строкатому тлі.
    `<rect x="${halo + 1}" y="${halo + 3}" width="${w - 2}" height="${h - 2}" rx="10" fill="#0A0A0A" opacity="0.22"/>` +
    `<rect x="${halo + 1}" y="${halo + 1}" width="${w - 2}" height="${h - 2}" rx="10" fill="${bg}" stroke="#fff" stroke-width="2.5"/>` +
    `<text x="${width / 2}" y="${height / 2 + 0.5}" fill="${fg}" font-family="system-ui,-apple-system,sans-serif"` +
    ` font-size="15" font-weight="800" letter-spacing="-0.2" text-anchor="middle" dominant-baseline="central">${label}</text>` +
    `</svg>`;

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(width, height),
    anchor: new google.maps.Point(width / 2, height / 2),
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
  /** Поточний масштаб: за ним рахується, які номери злиплися. */
  const [zoom, setZoom] = useState<number | null>(null);
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
        // Масштаб окремо від меж: накладання значків залежить лише від
        // нього, а межі міняє ще й звичайне перетягування.
        mapRef.current.addListener("zoom_changed", () => {
          setZoom(mapRef.current?.getZoom() ?? null);
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

    const pins = spread(plan?.stops ?? []);

    /**
     * Пікселі поточного масштабу — з проєкції карти.
     *
     * Світові координати Google не залежать від масштабу, тому множимо на
     * 2^zoom: саме ця величина каже, чи значки перекриються на екрані.
     * Проєкція буває ще не готова в перші кадри — тоді нічого не зливаємо,
     * як було досі, а після першого `idle` шар перемалюється вже з нею.
     */
    const projection = map.getProjection();
    const scale = 2 ** (map.getZoom() ?? 0);
    const groups = projection
      ? clusterPins(pins, (p) => {
          const w = projection.fromLatLngToPoint(new google.maps.LatLng(p.lat, p.lng));
          return { x: (w?.x ?? 0) * scale, y: (w?.y ?? 0) * scale };
        })
      : pins.map((s) => ({ lead: s, items: [s], label: s.errand ? "+" : String(s.seq) }));

    // Поточна ціль малюється останньою — щоб не ховалася під сусідами.
    const ordered = [...groups].sort(
      (a, b) => Number(!!a.lead.current) - Number(!!b.lead.current)
    );

    ordered.forEach((g) => {
      const s = g.lead;
      const many = g.items.length > 1;
      const { bg, fg } = PLAN_COLORS[s.status];
      /**
       * Група фарбується як «ще їхати», навіть коли перша точка в ній уже
       * закрита: зелений значок із написом «4–6» казав би, що зроблено всі
       * три. Що саме зроблено, видно в підказці.
       */
      const anyLeft = g.items.some((x) => x.status === "PENDING");
      const groupBg = anyLeft ? PLAN_COLORS.PENDING.bg : bg;
      const groupFg = anyLeft ? PLAN_COLORS.PENDING.fg : fg;

      const marker = new google.maps.Marker({
        position: { lat: s.lat, lng: s.lng },
        map,
        icon: planIcon(
          g.label,
          s.current ? "#2563EB" : many ? groupBg : bg,
          s.current ? "#fff" : many ? groupFg : fg,
          !!s.current
        ),
        zIndex: s.current ? 1000 : many ? 950 : 900,
        /**
         * Растеризацію вимикаємо навмисно.
         *
         * З нею Google зводить маркери в спільне полотно й малює SVG раз, у
         * логічних пікселях, — на планшеті з щільним екраном номер виходить
         * мильним. Саме на це водії й скаржилися. Точок маршруту десятки, а
         * не тисячі, тож окремі вузли DOM тут нічого не коштують.
         */
        optimized: false,
      });

      marker.addListener("click", () =>
        openInfo(marker, many ? clusterPopupHtml(g.items) : planPopupHtml(s))
      );
      planMarkersRef.current.push(marker);
      // Кожна точка групи має знаходити свій значок: із екрана дня водій
      // тапає «На карті» на конкретному клієнті.
      g.items.forEach((x) => byKeyRef.current.set(x.key, marker));
      g.items.forEach((x) => bounds.extend({ lat: x.lat, lng: x.lng }));
    });

    // Перше вікно ставить маршрут, якщо він є, — і лише один раз.
    if (!fittedRef.current && !bounds.isEmpty() && !focusRef.current) {
      map.fitBounds(bounds, 40);
      fittedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey, zoom, ready]);

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
