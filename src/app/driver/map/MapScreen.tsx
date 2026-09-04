"use client";

/**
 * Карта водія: клієнти й відкритий маршрутний лист.
 *
 * Та сама карта, що в торгового, але портфель інший: у водія немає
 * закріплених клієнтів — його точки це ті, куди він реально їздив. І
 * задача інша: торговий шукає, до кого заїхати, водій — де саме той
 * магазин, до якого він їде вперше.
 *
 * Поверх клієнтів лежить шар маршруту. Раніше він був єдиний і мовчазний:
 * підсвічувалися точки САМЕ СЬОГОДНІШНЬОГО дня, і тільки вони — вчорашній
 * лист чи переданий на завтра подивитися на карті було ніяк. Тепер лист
 * обирається в шторці, а карта показує його номерними пінами в порядку
 * обʼїзду.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { CLIENT_STATE, type ClientStateKey } from "@/lib/analytics/colors";
import { ClientOrderModal } from "@/app/admin/sales-analytics/components/ClientOrderModal";
import { ClientCommentsModal } from "@/app/admin/sales-analytics/components/ClientCommentsModal";
import { DriverPinModal } from "@/components/driver/DriverPinModal";
import { RouteChip, RouteSheet, formatRouteDay } from "@/components/driver/RoutePicker";
import { navigateUrl } from "@/lib/maps/google-links";
import { useNavApp } from "@/lib/maps/use-nav-app";
import { kyivToday } from "@/components/ui/PeriodPicker";
import type { DayStop } from "@/lib/track/day-stop-type";
import { planCore } from "@/lib/maps/plan-core";
import { hasGoogleMaps } from "@/lib/maps/google-loader";
import RoutePanel, { type Horizon, type PanelStop, type RouteOrder } from "./RoutePanel";
import type { DayPlan, PlanStop, SalesClientPoint } from "@/components/map/SalesClientsMap";

/**
 * Яку карту малювати.
 *
 * Є ключ Google — його; немає — нашу, на OpenStreetMap. Водії знають
 * картинку Google напам'ять, і в селі під Львовом читають її швидше:
 * інші підписи, більше орієнтирів у приватному секторі. Обидві реалізації
 * мають однаковий інтерфейс, тож вибір — один рядок, а не дві гілки в
 * коді екрана.
 */
const LeafletMap = dynamic(() => import("@/components/map/SalesClientsMap"), {
  ssr: false,
  loading: () => <div style={{ height: "100%", width: "100%", background: "#E5E7EB" }} />,
});
const GoogleMap = dynamic(() => import("@/components/map/DriverGoogleMap"), {
  ssr: false,
  loading: () => <div style={{ height: "100%", width: "100%", background: "#E5E7EB" }} />,
});
const RouteMap = hasGoogleMaps ? GoogleMap : LeafletMap;

type DriverClient = SalesClientPoint & {
  visits: number;
  lastVisitAt: string | null;
  today: boolean;
  mine: boolean;
};

type Resp = {
  day: string;
  clients: DriverClient[];
  counts: Record<string, number>;
  todayCount: number;
  mineCount: number;
  approximateCount: number;
};

/** Відповідь /api/tablet/day — беремо з неї лише маршрут. */
type DayResp = {
  day: string;
  route: {
    id: string | null;
    day: string | null;
    number: string | null;
    vehicle: string | null;
    /** Пробіг за планом із документа — запасне число, коли OSRM мовчить */
    plannedKm: number | null;
    geometry: { type: string; coordinates: [number, number][] } | null;
    stops: DayStop[];
  };
};

/** Дорога по відкритому листу: лінія, кілометри, перегони. */
type LineResp = {
  order: "sheet" | "optimal";
  geometry: { type: string; coordinates: [number, number][] } | null;
  totalKm: number | null;
  totalMin: number | null;
  legs: Array<{ distanceKm: number; durationMin: number }>;
  /** Точки в тому порядку, яким пройшла лінія */
  stopKeys: string[];
  skipped: number;
  error?: string;
};

/**
 * Що показувати на карті. Раніше вибірка була жорстко «мої» — і новий
 * водій бачив рівно сьогоднішній виїзд, тобто порожню карту.
 */
type Scope = "route" | "mine" | "all";

const LEGEND: ClientStateKey[] = ["ACTIVE", "NEW", "SLIPPING", "DORMANT", "LOST"];

/** Стан точки маршруту так, як його малює карта. */
function planStatus(stop: DayStop): PlanStop["status"] {
  if (stop.visit?.status === "DONE") return "DONE";
  if (stop.visit?.status === "MISSED") return "MISSED";
  return "PENDING";
}

export default function DriverMapScreen() {
  const router = useRouter();
  const params = useSearchParams();
  /** null — сьогоднішній маршрут, який сервер знайде сам. */
  const routeKey = params.get("route");
  /**
   * Доба без номера листа — так приходять з історії маршрутів, де рядок
   * знає лише дату. Ключ маршруту сильніший: якщо він є, дата зайва.
   */
  const dayKey = routeKey ? null : params.get("day");
  /** Ключ точки, на якій треба одразу стати. Приходить із екрана дня. */
  const focusKey = params.get("focus");

  const [data, setData] = useState<Resp | null>(null);
  const [day, setDay] = useState<DayResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  /**
   * null — водій ще не вибирав сам.
   *
   * Тоді обсяг диктує маршрут: відкрив лист — бачить його точки, немає
   * листа — усю базу. Раніше замовчуванням було жорстке «всі», і 26 пінів
   * маршруту губилися серед трьох тисяч кружечків. Щойно людина тапнула
   * сегмент — її вибір головніший, і сам він більше не зміниться.
   */
  const [scope, setScope] = useState<Scope | null>(null);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focus, setFocus] = useState<{ lat: number; lng: number; id?: string; nonce: number } | null>(null);
  const [orderFor, setOrderFor] = useState<{ id: string; name: string; state: ClientStateKey } | null>(null);
  const [commentsFor, setCommentsFor] = useState<{ id: string; name: string } | null>(null);
  const [pinFor, setPinFor] = useState<DriverClient | null>(null);
  // Той самий вибір, що на екрані дня: обрав Waze один раз — він Waze усюди.
  const [navApp] = useNavApp();

  /**
   * Дорога разом із адресою, для якої її рахували.
   *
   * Не просто LineResp: коли водій перемикає порядок або відкриває інший
   * лист, стара лінія ще лежить у стані, і без цієї мітки карта секунду
   * малювала б дорогу попереднього маршруту з номерами нового. Скидати її
   * в ефекті не можна (setState синхронно в ефекті — зайвий перемальовок),
   * тому просто не вважаємо своєю.
   */
  const [line, setLine] = useState<{ for: string; data: LineResp | null } | null>(null);
  /**
   * Який порядок показуємо.
   *
   * За замовчуванням — з листа: саме ці номери водій бачить на папері й
   * називає диспетчеру. Найкоротший — окремим перемикачем, бо це наша
   * порада, а не документ.
   */
  /**
   * Порядок за замовчуванням — логістичний, а не з листа.
   *
   * Номери рядків у документі 1С обʼїздом не є: той самий район вони
   * обходять за 900 км замість двохсот. Водій, що бачить список уперше,
   * має бачити дорогу, а не порядок набивання документа. Сам лист поруч,
   * окремою кнопкою — його номери він називає в офіс.
   */
  const [order, setOrder] = useState<RouteOrder>("optimal");
  /** Порядок, який водій перетягнув собі. null — ще не зберігав. */
  const [myOrder, setMyOrder] = useState<string[] | null>(null);
  const [horizon, setHorizon] = useState<Horizon>(null);
  const [editing, setEditing] = useState(false);
  /** Точка, до якої водій попросив побудувати дорогу — питаємо підтвердження. */
  const [askFor, setAskFor] = useState<PanelStop | null>(null);

  // Тягнемо завжди повний набір: 379 точок — одна відповідь, а перемикання
  // «маршрут / мої / всі» після цього миттєве, без походу в мережу.
  useEffect(() => {
    let alive = true;
    fetch("/api/driver/my-map?scope=all")
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error ?? `Помилка ${r.status}`);
        return j as Resp;
      })
      .then((j) => alive && setData(j))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Не вдалося завантажити"));
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Маршрут окремим запитом і з власним життям: клієнти тягнуться раз, а
   * лист міняється щоразу, коли водій обирає інший у шторці.
   */
  useEffect(() => {
    let alive = true;
    // Старий лист лишається на карті, поки їде новий: гасити карту в нуль
    // на секунду мобільного інтернету — це моргання без користі.
    fetch(
      routeKey
        ? `/api/tablet/day?route=${encodeURIComponent(routeKey)}`
        : dayKey
          ? `/api/tablet/day?day=${encodeURIComponent(dayKey)}`
          : "/api/tablet/day"
    )
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error ?? `Помилка ${r.status}`);
        return j as DayResp;
      })
      .then((j) => alive && setDay(j))
      .catch((e) => {
        if (!alive) return;
        // Не вийшло — прибираємо попередній лист: показувати чужі точки
        // під назвою нового маршруту гірше, ніж не показувати нічого.
        setDay(null);
        setError(e instanceof Error ? e.message : "Не вдалося завантажити маршрут");
      });
    return () => {
      alive = false;
    };
  }, [routeKey, dayKey]);

  /**
   * Дорогу тягнемо ОКРЕМИМ запитом, після того як приїхали точки.
   *
   * Разом із днем її віддавати не можна: маршрут сайту несе геометрію в
   * собі, а для листа 1С її треба рахувати через OSRM — і чекати на це
   * секунду щоразу, коли водій просто відкриває список точок, немає за що.
   */
  const routeId = day?.route.id ?? null;
  const hasOwnGeometry = !!day?.route.geometry;
  /**
   * Маршрут сайту вже несе свою лінію — рахувати нічого. Крім випадку, коли
   * водій сам попросив найкоротший порядок: його в документі немає.
   */
  const needsLine = !!routeId && !(hasOwnGeometry && order === "sheet");
  /**
   * Свій порядок — окремим параметром: сервер не тримає його в памʼяті між
   * запитами, а ключі водій щойно міг перетягнути.
   */
  const myKeysParam = order === "mine" && myOrder?.length ? myOrder.join(",") : "";
  const lineKey = routeId ? `${routeId}:${order}:${myKeysParam}` : "";
  const activeLine = line?.for === lineKey ? line.data : null;
  const lineLoading = needsLine && line?.for !== lineKey;

  useEffect(() => {
    if (!needsLine) return;
    let alive = true;
    fetch(
      `/api/driver/route-line?route=${encodeURIComponent(routeId!)}` +
        (order === "mine"
          ? `&order=custom&keys=${encodeURIComponent(myKeysParam)}`
          : `&order=${order}`)
    )
      .then((r) => (r.ok ? (r.json() as Promise<LineResp>) : null))
      .then((j) => alive && setLine({ for: lineKey, data: j }))
      .catch(() => alive && setLine({ for: lineKey, data: null }));
    return () => {
      alive = false;
    };
  }, [needsLine, routeId, order, lineKey, myKeysParam]);

  /**
   * Свій порядок читаємо ОДИН раз на маршрут.
   *
   * Якщо він є — саме його й показуємо: водій його не просто так складав.
   * Порядок сервера («логістичний») лишається поруч кнопкою.
   */
  useEffect(() => {
    if (!routeId) return;
    let alive = true;
    fetch(`/api/driver/route-order?route=${encodeURIComponent(routeId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ stopKeys: string[] | null }>) : null))
      .then((j) => {
        if (!alive || !j?.stopKeys?.length) return;
        setMyOrder(j.stopKeys);
        setOrder("mine");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [routeId]);

  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setMe({ lat: p.coords.latitude, lng: p.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }, []);

  const toggle = (k: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  /** Точки відкритого листа — лише ті, що мають координати. */
  const planStops = useMemo<PlanStop[]>(
    () =>
      (day?.route.stops ?? [])
        .filter((s) => s.lat != null && s.lng != null)
        .map((s) => ({
          key: s.key,
          seq: s.sequence,
          name: s.name,
          address: s.address,
          lat: s.lat as number,
          lng: s.lng as number,
          amount: s.amount,
          debt: s.debtAmount,
          status: planStatus(s),
          errand: s.kind !== "DELIVERY",
          mapUrl: navigateUrl({ lat: s.lat as number, lng: s.lng as number }, navApp),
        })),
    [day?.route.stops, navApp]
  );

  /**
   * Точки в тому порядку, який зараз показуємо, з наскрізною нумерацією.
   *
   * У найкоротшому порядку номери мусять перерахуватися — інакше на карті
   * буде лінія одного маршруту з номерами іншого, тобто найгірше з двох.
   * У порядку листа лишаємо номери документа: саме їх водій називає в офіс.
   */
  const orderedStops = useMemo<PlanStop[]>(() => {
    // Порядок листа — номери документа, як їх набив 1С. Нічого не міняємо.
    if (order === "sheet") return planStops;

    // Свій порядок діє одразу, ще до того як приїде лінія: інакше після
    // перетягування список на секунду стрибав би назад.
    const keys = order === "mine" && myOrder?.length ? myOrder : activeLine?.stopKeys;
    if (!keys?.length) return planStops;

    const byKey = new Map(planStops.map((s) => [s.key, s]));
    const seq = keys
      .map((k) => byKey.get(k))
      .filter((s): s is PlanStop => !!s)
      .map((s, i) => ({ ...s, seq: i + 1 }));
    // Точки, які в дорогу не потрапили (криві координати) або зʼявилися
    // після збереження порядку, їдуть у хвіст — інакше вони просто зникнуть.
    const used = new Set(seq.map((s) => s.key));
    const tail = planStops.filter((s) => !used.has(s.key));
    return [...seq, ...tail.map((s, i) => ({ ...s, seq: seq.length + i + 1 }))];
  }, [order, activeLine, planStops, myOrder]);

  /**
   * Точка, до якої водій їде ЗАРАЗ — перша невідмічена в поточному порядку.
   *
   * Одна на весь маршрут: саме її пульсує пін і підсвічує рядок.
   */
  const currentKey = useMemo(
    () => orderedStops.find((s) => s.status === "PENDING")?.key ?? null,
    [orderedStops]
  );

  const plan = useMemo<DayPlan>(
    () =>
      orderedStops.length > 0
        ? {
            number: day?.route.number ?? null,
            geometry: activeLine?.geometry ?? day?.route.geometry ?? null,
            stops: orderedStops.map((s) => ({ ...s, current: s.key === currentKey })),
          }
        : null,
    [orderedStops, currentKey, day?.route.number, day?.route.geometry, activeLine?.geometry]
  );

  /** Клієнти відкритого листа — по них працює перший сегмент фільтра. */
  const routeClientIds = useMemo(
    () => new Set((day?.route.stops ?? []).map((s) => s.counterpartyId).filter(Boolean) as string[]),
    [day?.route.stops]
  );

  /**
   * Скільки точок у сегменті «Маршрут».
   *
   * Рахуємо по самому листу, а не по клієнтах карти: бонусна поїздка
   * клієнта не має взагалі, і без неї число під кнопкою не збігалося б із
   * тим, що водій бачить пінами.
   */
  const routeCount = planStops.length;

  /** Точки, що вилетіли з робочої області, — майже завжди кривий геокод. */
  const strayCount = routeCount - planCore(planStops).length;

  const effScope: Scope = scope ?? (routeCount > 0 ? "route" : "all");

  const visible = (data?.clients ?? [])
    .filter((c) => !hidden.has(c.state))
    .filter((c) =>
      effScope === "route"
        ? routeClientIds.size > 0
          ? routeClientIds.has(c.id)
          : c.today
        : effScope === "mine"
          ? c.mine
          : true
    );

  const pickRoute = useCallback(
    (key: string | null) => {
      // Через адресу, а не стан: відкритий лист має переживати оновлення
      // сторінки й ділитися посиланням з екраном відміток.
      router.replace(key ? `/driver/map?route=${encodeURIComponent(key)}` : "/driver/map");
    },
    [router]
  );

  /** Пін уточнили — правимо точку на місці, без перезавантаження всієї карти. */
  const applyPin = useCallback((id: string, lat: number, lng: number) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            clients: prev.clients.map((c) =>
              c.id === id ? { ...c, lat, lng, approximate: false } : c
            ),
            approximateCount: Math.max(0, prev.approximateCount - 1),
          }
        : prev
    );
  }, []);

  /**
   * Перегони, приклеєні до РЯДКІВ списку.
   *
   * legs[i] у відповіді — дорога від stopKeys[i] до stopKeys[i+1], а в
   * списку точок може бути більше (ті, через які лінія не пройшла). Тому
   * зіставляємо за ключем, а не за позицією: інакше «12 км» опиниться під
   * не тим магазином.
   */
  const legs = useMemo(() => {
    if (!activeLine?.stopKeys.length) return [] as LineResp["legs"];
    const at = new Map(activeLine.stopKeys.map((k, i) => [k, i]));
    return orderedStops.map((s) => {
      const i = at.get(s.key);
      return i == null ? undefined : activeLine.legs[i];
    });
  }, [activeLine, orderedStops]);

  /**
   * Точка, задана адресою — карта відлітає до неї сама.
   *
   * Так «подивитися, де це» лишається в нашому застосунку: раніше єдиною
   * кнопкою в рядку дня була «Відкрити в Google Maps», і водій, якому
   * треба було просто глянути на місце, щоразу вилітав у чужу програму.
   *
   * Похідне значення, а не стан в ефекті: `nonce` сталий, тож політ
   * станеться один раз — коли точка знайдеться. Далі водій возить карту
   * сам, і повертати її на те саме місце після кожної перемальовки було б
   * знущанням. Щойно він тапне будь-який рядок, його вибір (стан `focus`)
   * перекриває адресу.
   */
  const urlFocus = useMemo(() => {
    if (!focusKey) return null;
    const stop = (day?.route.stops ?? []).find((st) => st.key === focusKey);
    if (!stop || stop.lat == null || stop.lng == null) return null;
    return { lat: stop.lat, lng: stop.lng, id: stop.key, nonce: 1 };
  }, [focusKey, day?.route.stops]);

  /** Точки для панелі: з поточною ціллю й відстанню до наступної. */
  const panelStops = useMemo<PanelStop[]>(
    () =>
      orderedStops.map((s, i) => ({
        ...s,
        current: s.key === currentKey,
        legKm: legs[i]?.distanceKm ?? null,
      })),
    [orderedStops, currentKey, legs]
  );

  /** «Мій» зʼявляється в перемикачі, лише коли водій щось перетягнув. */
  const availableOrders = useMemo<RouteOrder[]>(
    () => (myOrder?.length ? ["mine", "optimal", "sheet"] : ["optimal", "sheet"]),
    [myOrder]
  );

  /**
   * Перетягнули рядок — зберігаємо одразу, без кнопки «зберегти».
   *
   * Стан міняємо ДО відповіді сервера: за кермом список мусить лягти на
   * місце в ту ж мить, а не за секунду мобільного інтернету. Не збереглося
   * — скажемо про це, і порядок лишиться до кінця дня в памʼяті вкладки.
   */
  const saveOrder = useCallback(
    (keys: string[]) => {
      setMyOrder(keys);
      setOrder("mine");
      if (!routeId) return;
      void fetch("/api/driver/route-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ route: routeId, stopKeys: keys }),
      })
        .then((r) => {
          if (!r.ok) setError("Порядок не зберігся — він діятиме лише до перезавантаження");
        })
        .catch(() => setError("Порядок не зберігся — він діятиме лише до перезавантаження"));
    },
    [routeId]
  );

  /**
   * Поставити точку наступною — не міняючи решти.
   *
   * Пересуваємо її перед першою невідміченою, а не на початок списку:
   * відмічені точки лишаються там, де були, інакше пройдений день
   * перемішався б заднім числом.
   */
  const makeNext = useCallback(
    (stop: PanelStop) => {
      const keys = orderedStops.map((s) => s.key).filter((k) => k !== stop.key);
      const at = keys.findIndex(
        (k) => orderedStops.find((s) => s.key === k)?.status === "PENDING"
      );
      keys.splice(at === -1 ? keys.length : at, 0, stop.key);
      saveOrder(keys);
    },
    [orderedStops, saveOrder]
  );

  const resetOrder = useCallback(() => {
    setMyOrder(null);
    setOrder("optimal");
    setEditing(false);
    if (!routeId) return;
    void fetch(`/api/driver/route-order?route=${encodeURIComponent(routeId)}`, {
      method: "DELETE",
    }).catch(() => {});
  }, [routeId]);

  /** Скільки всього дороги — числом, яке видно в шапці панелі. */
  const totals = useMemo(() => {
    const km = activeLine?.totalKm ?? day?.route.plannedKm ?? null;
    if (km == null) return null;
    const min = activeLine?.totalMin ?? null;
    const hours =
      min == null ? "" : min >= 60 ? `${Math.floor(min / 60)} год ${min % 60} хв` : `${min} хв`;
    return { km: String(km).replace(".", ","), hours };
  }, [activeLine, day?.route.plannedKm]);

  const routeDone = planStops.filter((s) => s.status !== "PENDING").length;
  const routeDay = day?.route.day ?? day?.day ?? "";
  const chipTitle = day
    ? day.route.number
      ? `Маршрут ${day.route.number}`
      : "Маршруту немає"
    : "Завантаження маршруту…";
  const chipSubtitle = day
    ? routeCount > 0
      ? `${formatRouteDay(routeDay, kyivToday())} · ${routeDone} з ${routeCount} точок`
      : "Оберіть маршрутний лист"
    : null;

  return (
    // Фіксований шар на всю висоту мінус нижнє меню водія
    <div
      className="fixed inset-x-0"
      style={{
        top: 0,
        bottom: "calc(4rem + env(safe-area-inset-bottom, 0px))",
        background: "#F3F4F6",
      }}
    >
      <div className="absolute inset-0">
        <RouteMap
          clients={visible}
          route={null}
          plan={plan}
          me={me}
          focus={focus ?? urlFocus}
          // Картки клієнта в розділі водія немає (там лише маршрути), тож
          // посилання не даємо — натомість коментарі й уточнення піна.
          extras={{ comments: true, pin: true }}
          onAction={(a) => {
            const c = data?.clients.find((x) => x.id === a.id);
            if (!c) return;
            if (a.kind === "orderCard") setOrderFor({ id: c.id, name: c.name, state: c.state });
            else if (a.kind === "comments") setCommentsFor({ id: c.id, name: c.name });
            else if (a.kind === "pin") setPinFor(c);
          }}
        />
      </div>

      {/* Шапка поверх карти */}
      {/* На планшеті шапка кінчається там, де починається список: інакше
          сегмент «Всі» опиняється під панеллю й у нього не влучити. */}
      <div
        className="absolute inset-x-0 top-0 z-[500] px-3 lg:right-[380px]"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 10px)",
          paddingBottom: "10px",
          background: "linear-gradient(#F3F4F6EE, #F3F4F600)",
        }}
      >
        <div className="flex items-center gap-2">
          {/* Плашка маршруту стоїть там, де раніше був лічильник клієнтів:
              водій відкриває карту заради маршруту, а скільки на ній точок —
              видно в сегментах нижче. */}
          <RouteChip title={chipTitle} subtitle={chipSubtitle} onClick={() => setPickerOpen(true)} />

          <button
            type="button"
            onClick={locate}
            aria-label="Де я"
            className="flex shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-200"
            style={{
              minWidth: "40px",
              minHeight: "40px",
              background: "#fff",
              boxShadow: "0 1px 6px rgba(0,0,0,0.15)",
              border: "none",
            }}
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke={locating ? "#9CA3AF" : "#2563EB"}
              strokeWidth={1.9}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v3m0 14v3M2 12h3m14 0h3" />
              <circle cx="12" cy="12" r="6" />
            </svg>
          </button>
        </div>

        {/* Обсяг карти. Окремим рядом, а не в шапці: три варіанти поруч із
            плашкою маршруту не влазять у 800px портрета, і «Всі» опинялося б
            за краєм. Сегменти — 44px заввишки, у них цілять пальцем у машині. */}
        {data && (
          <div
            className="mt-2 flex gap-1 rounded-full p-1"
            style={{ background: "#fff", boxShadow: "0 1px 6px rgba(0,0,0,0.12)" }}
          >
            {(
              [
                { key: "route", label: "Маршрут", n: routeCount || data.todayCount },
                { key: "mine", label: "Мої", n: data.mineCount },
                { key: "all", label: "Всі", n: data.clients.length },
              ] as Array<{ key: Scope; label: string; n: number }>
            ).map((s) => {
              const on = effScope === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setScope(s.key)}
                  aria-pressed={on}
                  className="flex-1 cursor-pointer rounded-full transition-colors duration-200"
                  style={{
                    minHeight: "40px",
                    border: "none",
                    background: on ? "#0A0A0A" : "transparent",
                    color: on ? "#fff" : "#374151",
                    fontSize: "13px",
                    fontWeight: on ? 700 : 500,
                  }}
                >
                  {s.label}{" "}
                  <span style={{ color: on ? "rgba(255,255,255,0.65)" : "#9CA3AF", fontWeight: 400 }}>
                    {s.n}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div
          className="absolute inset-x-3 z-[500] rounded-xl p-3"
          style={{ top: "70px", background: "#FEF2F2", border: "1px solid #FECACA" }}
        >
          <p style={{ fontSize: "13px", color: "#B91C1C" }}>{error}</p>
        </div>
      )}

      {/*
        Список маршруту. На планшеті — колонкою праворуч від карти, на
        телефоні — шторкою знизу. Один компонент на обидва: два списки
        розійшлися б на першій же правці.
      */}
      {data && (
        <div
          className="absolute inset-x-0 bottom-0 z-[500] px-3 pb-3 lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[380px] lg:px-0 lg:pb-0"
          style={{ pointerEvents: "none" }}
        >
          <div
            className="flex max-h-[70vh] flex-col rounded-2xl lg:h-full lg:max-h-none lg:rounded-none"
            style={{
              background: "#fff",
              boxShadow: "0 -1px 12px rgba(0,0,0,0.12)",
              pointerEvents: "auto",
              overflow: "hidden",
            }}
          >
            {/* Шапка-перемикач потрібна лише на телефоні: у колонці
                праворуч список і так відкритий увесь час. */}
            <button
              type="button"
              onClick={() => setSheetOpen((v) => !v)}
              className="flex w-full cursor-pointer items-center gap-2 px-4 lg:hidden"
              style={{ background: "none", border: "none", minHeight: "48px" }}
            >
              <span style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>
                {routeCount > 0 ? `Маршрут · ${routeDone} з ${routeCount}` : "Фільтр за станом"}
              </span>
              {routeCount > 0 && (
                <span style={{ fontSize: "12px", color: "#6B7280" }}>
                  {lineLoading ? "рахую дорогу…" : totals ? `${totals.km} км · ${totals.hours}` : ""}
                </span>
              )}
              <svg
                className="ml-auto h-4 w-4"
                style={{ transform: sheetOpen ? "rotate(180deg)" : "none", transition: "transform .15s" }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="#9CA3AF"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
              </svg>
            </button>

            <div className={`min-h-0 flex-1 flex-col ${sheetOpen ? "flex" : "hidden"} lg:flex`}>
              {routeCount > 0 ? (
                <RoutePanel
                  stops={panelStops}
                  order={order}
                  orders={availableOrders}
                  onOrderChange={setOrder}
                  horizon={horizon}
                  onHorizonChange={setHorizon}
                  editing={editing}
                  onEditingChange={setEditing}
                  onReorder={saveOrder}
                  onResetOrder={resetOrder}
                  onPick={setAskFor}
                  onFocus={(st) => setFocus({ lat: st.lat, lng: st.lng, id: st.key, nonce: Date.now() })}
                  totals={totals}
                  loading={lineLoading}
                  strayCount={strayCount}
                />
              ) : (
                <p className="px-4 py-4" style={{ fontSize: "13px", color: "#6B7280", lineHeight: 1.5 }}>
                  Маршрут не відкрито. Оберіть маршрутний лист угорі — і тут зʼявиться список точок
                  по черзі.
                </p>
              )}

              {/* Легенда-фільтр з'їхала вниз і згорнута: вона про клієнтів
                  на карті, а головне тут — маршрут. */}
              <div style={{ borderTop: "1px solid #F1F1EF" }}>
                <button
                  type="button"
                  onClick={() => setLegendOpen((v) => !v)}
                  className="flex w-full cursor-pointer items-center gap-2 px-3"
                  style={{ background: "none", border: "none", minHeight: "42px" }}
                >
                  <span style={{ fontSize: "12.5px", fontWeight: 600, color: "#6B7280" }}>
                    Клієнти на карті
                  </span>
                  {data.approximateCount > 0 && (
                    <span style={{ fontSize: "11.5px", color: "#D97706" }}>
                      {data.approximateCount} приблизних
                    </span>
                  )}
                  <svg
                    className="ml-auto h-4 w-4"
                    style={{
                      transform: legendOpen ? "rotate(180deg)" : "none",
                      transition: "transform .15s",
                    }}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="#9CA3AF"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                  </svg>
                </button>

                {legendOpen && (
                  <div className="px-3 pb-3">
                    <div className="flex flex-wrap gap-1.5">
                      {LEGEND.map((k) => {
                        const off = hidden.has(k);
                        const n = data.counts[k] ?? 0;
                        return (
                          <button
                            key={k}
                            type="button"
                            onClick={() => toggle(k)}
                            aria-pressed={!off}
                            className="flex cursor-pointer items-center gap-1.5 rounded-full px-3 transition-colors duration-200"
                            style={{
                              minHeight: "38px",
                              border: "1px solid #E5E7EB",
                              background: off ? "#F3F4F6" : "#fff",
                              opacity: off ? 0.55 : 1,
                            }}
                          >
                            <span
                              aria-hidden
                              style={{
                                width: "9px",
                                height: "9px",
                                borderRadius: "50%",
                                background: CLIENT_STATE[k].color,
                              }}
                            />
                            <span style={{ fontSize: "12px", color: "#0A0A0A" }}>
                              {CLIENT_STATE[k].label}
                            </span>
                            <span style={{ fontSize: "12px", color: "#9CA3AF" }}>{n}</span>
                          </button>
                        );
                      })}
                    </div>
                    <p style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "8px", lineHeight: 1.4 }}>
                      Квадрати з номерами — точки маршруту, кола — клієнти. «Мої» — куди ви вже
                      возили, «Всі» — уся база. Тапніть точку: борг, що клієнт брав, коментарі.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}


      {/*
        Тап по клієнту в списку. Питаємо, а не ведемо одразу: палець за
        кермом влучає не туди, і мовчазний перехід у Google Maps посеред
        дороги — найгірше, що може статися з відкритим маршрутом.

        Дві дії, бо «побудувати маршрут сюди» означає різне. Або «веди мене
        туди зараз» — і тоді дорога від живого місця водія. Або «я поїду
        туди наступною» — і тоді міняється сам порядок, а решта точок
        лишається як була.
      */}
      {askFor && (
        <div
          className="fixed inset-0 z-[1000] flex flex-col justify-end"
          style={{ background: "rgba(10,10,10,0.45)" }}
          onClick={() => setAskFor(null)}
        >
          <div
            className="rounded-t-2xl bg-white p-4"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ fontSize: "13px", color: "#6B7280" }}>Побудувати маршрут сюди?</p>
            <p style={{ fontSize: "17px", fontWeight: 700, color: "#0A0A0A", marginTop: "2px" }}>
              {askFor.name}
            </p>
            {!!askFor.address && (
              <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "2px", lineHeight: 1.4 }}>
                {askFor.address}
              </p>
            )}

            <a
              href={navigateUrl({ lat: askFor.lat, lng: askFor.lng }, navApp)}
              target="_blank"
              rel="noopener"
              onClick={() => setAskFor(null)}
              className="cursor-pointer"
              style={{
                display: "block",
                marginTop: "12px",
                padding: "15px",
                borderRadius: "12px",
                background: "#2563EB",
                color: "#fff",
                fontSize: "16px",
                fontWeight: 700,
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              Їхати сюди в {navApp === "waze" ? "Waze" : "Google Maps"}
            </a>

            {askFor.key !== currentKey && (
              <button
                type="button"
                onClick={() => {
                  makeNext(askFor);
                  setAskFor(null);
                }}
                className="w-full cursor-pointer"
                style={{
                  marginTop: "8px",
                  padding: "14px",
                  borderRadius: "12px",
                  border: "1px solid #E5E7EB",
                  background: "#fff",
                  color: "#0A0A0A",
                  fontSize: "15px",
                  fontWeight: 700,
                }}
              >
                Зробити наступною в списку
              </button>
            )}

            <button
              type="button"
              onClick={() => setAskFor(null)}
              className="w-full cursor-pointer"
              style={{
                marginTop: "8px",
                padding: "12px",
                border: "none",
                background: "none",
                color: "#6B7280",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              Скасувати
            </button>
          </div>
        </div>
      )}

      {pickerOpen && (
        <RouteSheet
          // Коли прийшли з історії за датою, ключ листа знає лише відповідь
          // сервера — беремо його звідти, щоб у списку підсвітився відкритий.
          current={routeKey ?? (dayKey ? (day?.route.id ?? null) : null)}
          onPick={pickRoute}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {orderFor && (
        <ClientOrderModal key={orderFor.id} client={orderFor} onClose={() => setOrderFor(null)} />
      )}
      {commentsFor && (
        <ClientCommentsModal
          key={commentsFor.id}
          client={commentsFor}
          onClose={() => setCommentsFor(null)}
        />
      )}
      {pinFor && (
        <DriverPinModal
          key={pinFor.id}
          client={{
            id: pinFor.id,
            name: pinFor.name,
            lat: pinFor.lat,
            lng: pinFor.lng,
            approximate: pinFor.approximate,
          }}
          onClose={() => setPinFor(null)}
          onSaved={(lat, lng) => applyPin(pinFor.id, lat, lng)}
        />
      )}
    </div>
  );
}
