/**
 * Порядок обʼїзду на день — один на всі екрани.
 *
 * До цього їх було два, і вони мовчки розходилися. Екран дня й навігація
 * брали порядок рядків документа 1С, карта рахувала найкоротший обʼїзд — і
 * на листі 000001852 це 393,5 км проти 160,6. Водій дивився на карту з
 * номерами 1, 2, 3, натискав «Їхати» — і застосунок вів його зовсім іншою
 * чергою, бо пачку брав зі списку. Питання «чому навігація не збігається з
 * маршрутним листом» мало рівно цю відповідь.
 *
 * Тепер порядок рахується ТУТ і віддається день і карті однаково.
 *
 * Якір — СКЛАД, а не місце водія, і це принципово. Порядок мусить бути
 * сталим: якби він рахувався від живої координати, список перешиковувався б
 * щоразу, коли машина проїхала кілометр, і водій не міг би домовитися з
 * офісом навіть про те, яка точка друга. Дорогу «від мене зараз» карта
 * рахує окремою кнопкою — там це доречно, бо це разова порада.
 *
 * Точки без координат і викиди геокодування в обʼїзд не йдуть (вести
 * машину нікуди), але зі списку не зникають — вони стають у хвіст.
 */

import { getOptimalTrip } from "@/lib/geo/osrm";
import { planCore } from "@/lib/maps/plan-core";
import { defaultDepot } from "@/lib/routes/depot";
import type { DayRoute } from "@/lib/track/day-stops";

/**
 * Скільки тримаємо порахований порядок.
 *
 * Півгодини: склад точок за день майже не змінюється, а публічний OSRM
 * лімітований за частотою — і день водій відкриває десятки разів.
 */
const TTL_MS = 30 * 60_000;

/**
 * Скільки день ЧЕКАЄ на розрахунок, якщо в памʼяті його ще немає.
 *
 * Дві секунди — межа, за якою екран уже здається зламаним. Не встигли —
 * цього разу віддаємо порядок документа, а розрахунок доводиться до кінця
 * у фоні й лягає в кеш: наступне відкриття (через секунди) буде правильним.
 * Так холодний старт не тримає водія перед білим екраном.
 */
const DAY_BUDGET_MS = 2_000;

const cache = new Map<string, { at: number; keys: string[] | null }>();
/** Один розрахунок на маршрут: паралельні запити чекають на той самий. */
const inflight = new Map<string, Promise<string[] | null>>();

/**
 * Ключ включає СКЛАД точок, а не лише номер листа: обмін міг привезти нову
 * адресу, і старий порядок вів би повз неї.
 */
function cacheKey(route: DayRoute): string {
  return `${route.id}:${route.stops.map((s) => s.key).join(",")}`;
}

async function compute(route: DayRoute): Promise<string[] | null> {
  const withCoords = route.stops.filter((s) => s.lat != null && s.lng != null);

  /**
   * Викиди геокодування — повз обʼїзд.
   *
   * Клієнт, геокодований лише за назвою міста, стоїть за 400 км, і OSRM
   * чесно повів би туди й назад. Те саме правило, що звужує вікно карти й
   * рахує дорогу, тож порядок і лінія говорять про одні й ті самі точки.
   */
  const core = planCore(
    withCoords.map((s) => ({ key: s.key, lat: s.lat as number, lng: s.lng as number }))
  );
  if (core.length < 2) return null;

  const depot = await defaultDepot();
  const coords: [number, number][] = [
    ...(depot ? [[depot.lng, depot.lat] as [number, number]] : []),
    ...core.map((s) => [s.lng, s.lat] as [number, number]),
  ];

  const trip = await getOptimalTrip(coords);

  /**
   * waypoint_index — НОВА позиція точки, а не «яка точка стоїть i-ю».
   * Плутанина між цими двома трактуваннями і дає маршрути, що виглядають
   * випадковими (те саме розгортання, що в lib/routes/optimize.ts).
   */
  const byPosition: string[] = [];
  trip.waypointOrder.forEach((newPos, originalIdx) => {
    // Нульова координата — склад, а не точка маршруту.
    if (depot && originalIdx === 0) return;
    const stop = core[depot ? originalIdx - 1 : originalIdx];
    if (stop) byPosition[newPos] = stop.key;
  });

  const routed = byPosition.filter(Boolean);
  const inRoute = new Set(routed);
  // Хвіст — усе, чого дорога не торкнулася: без координат і викиди. У
  // порядку документа, щоб він хоч якось відповідав паперу.
  const tail = route.stops.filter((s) => !inRoute.has(s.key)).map((s) => s.key);

  return [...routed, ...tail];
}

/**
 * Порядок ключів точок для цього маршруту. null — рахувати нема з чого
 * (менше двох координат) або OSRM мовчить; тоді викликач лишає порядок
 * документа.
 */
export async function logisticOrder(
  route: DayRoute,
  opts?: { budgetMs?: number }
): Promise<string[] | null> {
  if (!route.id || route.stops.length < 2) return null;

  const key = cacheKey(route);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.keys;

  let job = inflight.get(key);
  if (!job) {
    job = compute(route)
      .catch(() => null)
      .then((keys) => {
        cache.set(key, { at: Date.now(), keys });
        inflight.delete(key);
        // Кеш не має рости безмежно на довгому процесі.
        if (cache.size > 200) {
          for (const [k, v] of cache) if (Date.now() - v.at > TTL_MS) cache.delete(k);
        }
        return keys;
      });
    inflight.set(key, job);
  }

  const budget = opts?.budgetMs;
  if (!budget) return job;

  /**
   * Гонка з межею часу, а не скасування: розрахунок їде далі й лягає в кеш.
   * Той, хто відкриє день наступним, отримає його вже готовим.
   */
  return Promise.race([
    job,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), budget)),
  ]);
}

/**
 * Точки дня в тому порядку, яким їх треба їхати.
 *
 * Одне правило на всі екрани, і саме тому воно тут, а не в кожному роуті:
 * розійшовшись, список і карта дають водієві два різні маршрути — рівно та
 * вада, через яку це й переписувалося.
 *
 * Порядок, який логіст проклав сам (у маршруту сайту є геометрія), лишаємо
 * недоторканим: там уже враховані боржники й напрямок обʼїзду, і
 * перераховувати його на планшеті означає мовчки викинути чужу роботу.
 */
export async function orderedDayStops<T extends DayRoute>(
  route: T,
  opts?: { budgetMs?: number }
): Promise<T["stops"]> {
  const logistApplied = route.source === "DELIVERY_ROUTE" && !!route.geometry;
  if (logistApplied) return route.stops;

  const keys = await logisticOrder(route, opts);
  if (!keys?.length) return route.stops;

  const byKey = new Map(route.stops.map((s) => [s.key, s]));
  const picked = keys.map((k) => byKey.get(k)).filter((s): s is T["stops"][number] => !!s);
  const used = new Set(picked.map((s) => s.key));
  return [...picked, ...route.stops.filter((s) => !used.has(s.key))];
}

export { DAY_BUDGET_MS };
