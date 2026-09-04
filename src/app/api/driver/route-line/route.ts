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

  const route = await resolveDriverRoute(auth.me.userId, routeKey);
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

  // Одна точка — не маршрут. Порожня відповідь, а не помилка: карта просто
  // намалює пін без лінії.
  if (stops.length < 2) {
    return NextResponse.json({
      order: orderParam ?? "sheet",
      geometry: null,
      totalKm: null,
      totalMin: null,
      legs: [],
      stopKeys: [],
      skipped: withCoords.length - stops.length,
    });
  }

  // Ключ кеша включає СКЛАД точок, а не лише номер листа: логіст міг
  // прибрати точку, і стара лінія показувала б заїзд, якого вже немає.
  const key = `${auth.me.userId}:${routeKey}:${wantOptimal ? "opt" : "seq"}:${stops.map((s) => s.key).join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.body);

  try {
    const coords = stops.map((s) => [s.lng, s.lat] as [number, number]);

    /**
     * waypoint_index — позиція точки в ОПТИМІЗОВАНОМУ маршруті, а не номер
     * точки, яку відвідують i-ю. Плутанина між цими двома трактуваннями —
     * класична причина маршрутів, що виглядають випадковими (те саме
     * розгортання, що в lib/routes/optimize.ts).
     */
    let ordered = stops;
    let res;
    if (wantOptimal) {
      const trip = await getOptimalTrip(coords);
      const byPosition: typeof stops = [];
      trip.waypointOrder.forEach((newPos, originalIdx) => {
        byPosition[newPos] = stops[originalIdx];
      });
      ordered = byPosition.filter(Boolean);
      res = trip;
    } else {
      res = await getRoute(coords);
    }

    const body = {
      order: orderParam ?? "sheet",
      geometry: res.geometry,
      totalKm: res.totalDistanceKm,
      totalMin: res.totalDurationMin,
      /** Перегін i — дорога від stopKeys[i] до stopKeys[i + 1] */
      legs: res.legs,
      /**
       * Точки, через які лінія справді пройшла, у порядку обʼїзду.
       *
       * Без них перегони нема до чого приклеїти: у списку на екрані точок
       * більше, ніж у лінії, і третій перегін легко ліг би між не тими
       * рядками.
       */
      stopKeys: ordered.map((s) => s.key),
      /** Скільки точок лишилося поза дорогою через криві координати */
      skipped: withCoords.length - stops.length,
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
      error: e instanceof Error ? e.message : "OSRM недоступний",
    });
  }
}
