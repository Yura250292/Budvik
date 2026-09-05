/**
 * Дорога по відкритому маршрутному листу — лінією, а не пінами.
 *
 * Для маршруту сайту геометрія вже лежить у самому документі: її кладе
 * планувальник, коли логіст застосовує порядок точок. У листа з 1С її
 * немає й бути не може — там взагалі нічого, крім рядків із адресами. І
 * саме такі листи в більшості водіїв єдині: у Пайди, наприклад, маршрутів
 * сайту немає жодного.
 *
 * Тому карта показувала йому купку пронумерованих квадратиків без жодної
 * лінії між ними — за таким «маршрутом» новій людині зорієнтуватися ніяк.
 * Тут ця лінія рахується на льоту через той самий OSRM, що й у
 * планувальнику.
 *
 * Разом із лінією віддаємо відстані ПО ПЕРЕГОНАХ. Це головне, заради чого
 * новий водій відкриває огляд: не «весь маршрут 277 км», а «від третьої
 * точки до четвертої — двадцять хвилин, встигну до обіду».
 *
 * Порядків два, і це не забаганка. Номери в листі 1С — це порядок РЯДКІВ У
 * ДОКУМЕНТІ, а не порядок обʼїзду: лист 000001848 стрибає Івано-Франкове →
 * Чолгині → Новояворівськ → Жовква → Залужжя → Жовква → Потелич і назад, і
 * дорога по ньому виходить 902 км замість двохсот із чимось на район
 * завширшки пʼятдесят кілометрів. Досвідчений водій просто їде по-своєму, а
 * новий — саме той, кому потрібен огляд, — прочитав би ці номери як маршрут.
 * Тому поруч рахуємо найкоротший обʼїзд тих самих точок.
 *
 * Нічого не зберігаємо: це підказка водієві, а не зміна документа.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOptimalTrip, getRoute } from "@/lib/geo/osrm";
import { resolveDriverRoute } from "@/lib/track/day-stops";
import { planCore } from "@/lib/maps/plan-core";
import { defaultDepot } from "@/lib/routes/depot";
import { orderedDayStops } from "@/lib/routes/day-order";
import { requireRoles, DRIVER_ROLES } from "@/lib/app/identity";

export const dynamic = "force-dynamic";

/**
 * Скільки тримаємо порахований маршрут.
 *
 * Публічний OSRM лімітований за частотою, а карту водій відкриває й
 * закриває десятки разів за день — і щоразу це той самий незмінний лист.
 * Півгодини вистачає, щоб денне гортання коштувало одного запиту, і замало,
 * щоб застаріти після правки маршруту логістом.
 */
const TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; body: unknown }>();

/** Розбирає `lng,lat` з адреси. Кривий параметр просто ігноруємо. */
function parseFrom(raw: string | null): { lat: number; lng: number } | null {
  if (!raw) return null;
  const [lng, lat] = raw.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Обрізаємо кеш, щоб він не ріс безмежно на довгому процесі. */
function remember(key: string, body: unknown) {
  if (cache.size > 200) {
    for (const [k, v] of cache) if (Date.now() - v.at > TTL_MS) cache.delete(k);
  }
  cache.set(key, { at: Date.now(), body });
}

export async function GET(req: NextRequest) {
  const auth = await requireRoles(req, DRIVER_ROLES);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const routeKey = url.searchParams.get("route");
  if (!routeKey) {
    return NextResponse.json({ error: "Не вказано маршрут" }, { status: 400 });
  }
  /**
   * sheet — як у листі; optimal — найкоротший обʼїзд тих самих точок;
   * custom — порядок, який водій перетягнув собі (ключі приходять у `keys`).
   */
  const orderParam = url.searchParams.get("order");
  const wantOptimal = orderParam === "optimal";
  const customKeys =
    orderParam === "custom" ? (url.searchParams.get("keys") ?? "").split(",").filter(Boolean) : [];

  /**
   * Звідки водій виїжджає ЗАРАЗ.
   *
   * Без цього найкоротший обʼїзд рахувався від першої точки документа
   * (source=first в OSRM) — тобто від чужого місця. Для того, хто вже
   * виїхав, це не порада, а помилка: перша точка може бути за сорок
   * кілометрів у зворотний бік, і весь порядок вибудовується навколо неї.
   *
   * Немає координати водія — беремо склад (той самий, що в оптимізатора
   * логіста). Немає й складу — лишається старий спосіб.
   */
  const from = parseFrom(url.searchParams.get("from"));
  /**
   * Точки, які водій уже закрив. Сервер про це не знає: відмітки лежать у
   * Visit за клієнтом і добою, а лист може бути чужий або вчорашній. Без
   * них дорога «звідки я» посеред дня вела б назад через уже відвідане.
   */
  const skipKeys = new Set(
    (url.searchParams.get("skip") ?? "").split(",").filter(Boolean)
  );

  const resolved = await resolveDriverRoute(auth.me.userId, routeKey, { anyDriver: true });

  /**
   * «Як у списку» мусить означати САМЕ те, що в списку.
   *
   * Резолвер віддає точки в порядку документа, а день показує їх у
   * логістичному — і лінія лягала б по одному порядку з номерами іншого.
   * Це та сама розбіжність, через яку навігація не збігалася з маршрутом,
   * тільки вже всередині карти. Найкоротший обʼїзд (`optimal`) рахується
   * нижче своїм шляхом, тож для нього порядок входу значення не має.
   */
  const route =
    wantOptimal || customKeys.length > 0
      ? resolved
      : { ...resolved, stops: await orderedDayStops(resolved) };

  const withCoords = route.stops
    .filter((s) => s.lat != null && s.lng != null)
    .map((s) => ({ key: s.key, lat: s.lat as number, lng: s.lng as number }));

  /**
   * Вилетілі точки в дорогу не беремо — і це не косметика.
   *
   * Клієнт, геокодований лише за назвою міста, стоїть за 400 км, і OSRM
   * чесно веде туди й назад: лист на 32 адреси показував 902 км і 16 годин
   * замість реальних двохсот із чимось. Новий водій прочитав би це як «мені
   * не встигнути» — тобто число не просто зайве, воно шкідливе.
   *
   * Те саме правило, що звужує вікно карти (lib/maps/plan-core.ts), тож
   * лінія проходить рівно по тому, що видно на екрані.
   */
  let stops = planCore(withCoords);

  /**
   * Свій порядок водія розкладаємо ТУТ, а не рахуємо заново.
   *
   * Ключі приходять із панелі, де він щойно перетягнув рядки; сервер лише
   * бере ті, що справді є в маршруті, і додає в хвіст ті, яких водій не
   * чіпав (маршрут могли поповнити після того, як він зберіг порядок).
   */
  if (customKeys.length > 0) {
    const byKey = new Map(stops.map((st) => [st.key, st]));
    const picked = customKeys.map((k) => byKey.get(k)).filter((st): st is (typeof stops)[number] => !!st);
    const used = new Set(picked.map((st) => st.key));
    stops = [...picked, ...stops.filter((st) => !used.has(st.key))];
  }

  /**
   * Відмічені лишаються в списку ключів, але з дороги виходять.
   *
   * Саме в такому вигляді, а не викинутими: панель на карті клеїть
   * перегони до рядків за ключем, і зникла точка зсунула б усі відстані на
   * одну позицію.
   */
  const doneStops = stops.filter((s) => skipKeys.has(s.key));
  const roadStops = stops.filter((s) => !skipKeys.has(s.key));

  // Одна точка — не маршрут. Порожня відповідь, а не помилка: карта просто
  // намалює пін без лінії.
  if (roadStops.length < 2) {
    return NextResponse.json({
      order: orderParam ?? "sheet",
      geometry: null,
      totalKm: null,
      totalMin: null,
      legs: [],
      stopKeys: doneStops.map((s) => s.key),
      skipped: withCoords.length - stops.length,
      anchor: null,
      approachKm: null,
      approachMin: null,
      approachTo: null,
    });
  }

  /**
   * Якір — місце, від якого рахується дорога.
   *
   * Спершу жива позиція водія, потім склад. Він іде в OSRM першою
   * координатою (source=first), але в список точок НЕ потрапляє: це не
   * точка маршруту, а те, звідки водій до неї їде.
   */
  const depot = from ? null : await defaultDepot();
  const anchor = from
    ? { kind: "me" as const, lat: from.lat, lng: from.lng, name: null as string | null }
    : depot
      ? { kind: "warehouse" as const, lat: depot.lat, lng: depot.lng, name: depot.name }
      : null;

  /**
   * Ключ кеша включає СКЛАД точок, а не лише номер листа: логіст міг
   * прибрати точку, і стара лінія показувала б заїзд, якого вже немає.
   *
   * Позицію водія округляємо до двох знаків (~1 км): інакше кожні сто
   * метрів руху давали б новий ключ, і кеш не спрацював би жодного разу —
   * а публічний OSRM лімітований за частотою. Того, хто дивиться, у ключі
   * немає навмисно: лист той самий, і двоє водіїв, які його відкрили,
   * діляться одним розрахунком.
   */
  const anchorKey = anchor
    ? anchor.kind === "me"
      ? `me:${anchor.lng.toFixed(2)},${anchor.lat.toFixed(2)}`
      : "wh"
    : "first";
  const key = `${routeKey}:${wantOptimal ? "opt" : "seq"}:${anchorKey}:${roadStops.map((s) => s.key).join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body);

  try {
    const coords: [number, number][] = [
      ...(anchor ? [[anchor.lng, anchor.lat] as [number, number]] : []),
      ...roadStops.map((s) => [s.lng, s.lat] as [number, number]),
    ];

    /**
     * waypoint_index — позиція точки в ОПТИМІЗОВАНОМУ маршруті, а не номер
     * точки, яку відвідують i-ю. Плутанина між цими двома трактуваннями —
     * класична причина маршрутів, що виглядають випадковими (те саме
     * розгортання, що в lib/routes/optimize.ts).
     */
    let ordered = roadStops;
    let res;
    if (wantOptimal) {
      const trip = await getOptimalTrip(coords);
      const byPosition: typeof roadStops = [];
      trip.waypointOrder.forEach((newPos, originalIdx) => {
        // Нульова координата — якір, а не точка маршруту: він задає, звідки
        // рахувати, і в списку його бути не повинно.
        if (anchor && originalIdx === 0) return;
        byPosition[newPos] = roadStops[anchor ? originalIdx - 1 : originalIdx];
      });
      ordered = byPosition.filter(Boolean);
      res = trip;
    } else {
      res = await getRoute(coords);
    }

    /**
     * Подача — перегін від якоря до першої точки — рахується окремо.
     *
     * Вона не частина обʼїзду: «маршрут 120 км» і «120 км маршруту плюс 18
     * від мене до першої точки» — різні відповіді на питання «чи встигну».
     * Заразом це вирівнює перегони: legs[i] знову означає дорогу від
     * stopKeys[i] до stopKeys[i + 1].
     */
    const approach = anchor ? (res.legs[0] ?? null) : null;
    const legs = anchor ? res.legs.slice(1) : res.legs;

    const body = {
      order: orderParam ?? "sheet",
      geometry: res.geometry,
      /**
       * Підсумок — БЕЗ подачі: «маршрут 120 км» має означати обʼїзд, а не
       * обʼїзд плюс дорогу від складу, яка сьогодні одна, а завтра інша.
       * Саму подачу віддаємо поруч окремим числом.
       */
      totalKm: approach
        ? Math.round((res.totalDistanceKm - approach.distanceKm) * 10) / 10
        : res.totalDistanceKm,
      totalMin: approach ? Math.max(0, res.totalDurationMin - approach.durationMin) : res.totalDurationMin,
      /**
       * Перегін i — дорога від stopKeys[i] до stopKeys[i + 1].
       *
       * Відмічені точки стоять на початку списку й дороги не мають: їхні
       * перегони — null, інакше відстані з'їхали б на одну позицію.
       */
      legs: [...doneStops.map(() => null), ...legs],
      /**
       * Точки, через які лінія справді пройшла, у порядку обʼїзду. Спершу
       * вже закриті (у порядку документа), потім те, що попереду.
       *
       * Без них перегони нема до чого приклеїти: у списку на екрані точок
       * більше, ніж у лінії, і третій перегін легко ліг би між не тими
       * рядками.
       */
      stopKeys: [...doneStops.map((s) => s.key), ...ordered.map((s) => s.key)],
      /** Скільки точок лишилося поза дорогою через криві координати */
      skipped: withCoords.length - stops.length,
      /** Звідки рахували дорогу: місце водія, склад або нічого */
      anchor,
      approachKm: approach?.distanceKm ?? null,
      approachMin: approach?.durationMin ?? null,
      /** До якої точки веде подача — щоб панель підписала саме її рядок */
      approachTo: ordered[0]?.key ?? null,
    };
    remember(key, body);
    return NextResponse.json(body);
  } catch (e) {
    /**
     * OSRM мовчить або лімітує — це не привід ламати екран.
     *
     * Карта в такому разі малює пунктир напряму між точками: порядок обʼїзду
     * з нього видно так само, а от відстані — ні, тому їх не вигадуємо.
     */
    return NextResponse.json({
      order: orderParam ?? "sheet",
      geometry: null,
      totalKm: null,
      totalMin: null,
      legs: [],
      stopKeys: [],
      skipped: withCoords.length - stops.length,
      anchor: null,
      approachKm: null,
      approachMin: null,
      approachTo: null,
      error: e instanceof Error ? e.message : "OSRM недоступний",
    });
  }
}
