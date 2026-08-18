/**
 * Порядок обʼїзду: найдешевше, але з поправкою на те, хто важливіший.
 *
 * Задача не зводиться до комівояжера. Найкоротший маршрут може лишити
 * боржника з 7 800 ₴ на вечір — і водій приїде до зачиненої каси. Тому
 * рахуємо ДВА варіанти й порівнюємо їх у гривнях:
 *
 *   1. cheapest — чистий OSRM Trip: мінімум кілометрів;
 *   2. balanced — той самий маршрут, у якому пріоритетні точки підтягнуті
 *      вперед, поки гак не перевищив ліміт (типово 15% пробігу).
 *
 * Обидва повертаються нагору: рішення ухвалює людина, бачачи ціну.
 *
 * Чому не віддали все OSRM: Trip API мінімізує лише відстань і не вміє
 * ані пріоритетів, ані вікон. А чому не віддали LLM (як робив старий
 * /api/erp/delivery-routes/[id]/optimize): модель ВИГАДУЄ кілометраж, і
 * цей вигаданий кілометраж потім лягав у розрахунок пального як факт.
 * Тут кожен кілометр — з OSRM, тобто з реальної дорожньої мережі.
 */

import { getOptimalTrip, getRoute } from "@/lib/geo/osrm";

export type OptimizeStop = {
  id: string;
  lat: number;
  lng: number;
  /** 0..1 з priority.ts */
  score: number;
};

/**
 * Напрямок обʼїзду. "nearest" — як їде OSRM Trip: від складу через ближні
 * точки, кінець маршруту в найдальшій. "farthest" — той самий ланцюжок
 * задом наперед: спершу довгий перегін у найдальшу точку, далі назад у бік
 * дому. Так хвіст дня опиняється біля складу, і якщо водій не встиг —
 * недовезене поруч і легко закривається завтра.
 */
export type Direction = "nearest" | "farthest";

export type RouteVariant = {
  /** Порядок id зупинок */
  order: string[];
  distanceKm: number;
  durationMin: number;
  fuelCost: number;
  geometry: GeoJSON.LineString | null;
  /**
   * Зважена «якість» порядку: сума score, поділена на позицію. Потрібна
   * лише для порівняння варіантів між собою, окремо не інтерпретується.
   */
  priorityScore: number;
};

export type OptimizeResult = {
  cheapest: RouteVariant;
  /** null, якщо збалансований збігся з найдешевшим */
  balanced: RouteVariant | null;
  /** Наскільки balanced довший за cheapest, % */
  detourPercent: number;
};

export type FuelParams = {
  /** л/100 км або кВт·год/100 км */
  consumption: number;
  /** ₴ за літр або кВт·год */
  pricePerUnit: number;
  /** Надбавка на затори й холодний двигун, % */
  bufferPercent?: number;
};

/** Скільки коштує проїхати стільки кілометрів. */
export function fuelCostFor(distanceKm: number, fuel: FuelParams): number {
  const units = (distanceKm * fuel.consumption) / 100;
  const withBuffer = units * (1 + (fuel.bufferPercent ?? 0) / 100);
  return Math.round(withBuffer * fuel.pricePerUnit);
}

/** Максимальний гак заради пріоритетів, частка від найкоротшого маршруту. */
export const DEFAULT_MAX_DETOUR = 0.15;

/**
 * Наскільки добре порядок обслуговує важливих клієнтів.
 *
 * Ділимо на позицію, а не віднімаємо: різниця між 1-ю і 2-ю точкою
 * важлива, між 14-ю і 15-ю — ні. Так і в житті: до обіду встигнеш і туди,
 * і туди, а от останню точку дня можна не встигнути зовсім.
 */
function orderQuality(order: OptimizeStop[]): number {
  return order.reduce((sum, s, i) => sum + s.score / (i + 1), 0);
}

/**
 * Пересуває пріоритетні точки вперед, поки маршрут не подорожчав понад
 * ліміт.
 *
 * Жадібний алгоритм, а не повний перебір: точок у денному маршруті
 * одиниці-десятки, і кожна перевірка коштує запиту в OSRM. Перебір усіх
 * перестановок — це сотні запитів до публічного демо-сервера, тобто
 * гарантований бан і хвилини очікування. Тут максимум кілька спроб.
 */
async function balanceOrder(
  start: [number, number],
  stops: OptimizeStop[],
  cheapestOrder: OptimizeStop[],
  cheapestKm: number,
  maxDetour: number
): Promise<{ order: OptimizeStop[]; distanceKm: number; durationMin: number; geometry: GeoJSON.LineString } | null> {
  // Кандидати на підтягування — точки з помітним пріоритетом, які стоять
  // не на початку. Поріг 0.35 відсікає «звичайні» точки: без нього
  // алгоритм смикав би маршрут заради клієнта без боргу й без історії.
  const candidates = cheapestOrder
    .map((s, i) => ({ stop: s, index: i }))
    .filter((x) => x.stop.score >= 0.35 && x.index > 0)
    .sort((a, b) => b.stop.score - a.stop.score);

  if (candidates.length === 0) return null;

  let best: { order: OptimizeStop[]; distanceKm: number; durationMin: number; geometry: GeoJSON.LineString } | null =
    null;
  let bestQuality = orderQuality(cheapestOrder);

  const limitKm = cheapestKm * (1 + maxDetour);

  for (const cand of candidates) {
    // Пробуємо поставити кандидата на кожну позицію вище за поточну.
    for (let target = 0; target < cand.index; target++) {
      const candidateOrder = cheapestOrder.filter((s) => s.id !== cand.stop.id);
      candidateOrder.splice(target, 0, cand.stop);

      const quality = orderQuality(candidateOrder);
      if (quality <= bestQuality) continue;

      const coords: [number, number][] = [start, ...candidateOrder.map((s) => [s.lng, s.lat] as [number, number])];
      let route;
      try {
        route = await getRoute(coords);
      } catch {
        // OSRM не відповів — цей варіант просто не розглядаємо.
        continue;
      }

      if (route.totalDistanceKm > limitKm) continue;

      best = {
        order: candidateOrder,
        distanceKm: route.totalDistanceKm,
        durationMin: route.totalDurationMin,
        geometry: route.geometry,
      };
      bestQuality = quality;
      // Знайшли покращення для цього кандидата — далі його не рухаємо,
      // беремося за наступного за важливістю.
      break;
    }
  }

  return best;
}

/**
 * Рахує обидва варіанти маршруту.
 *
 * `start` — склад або поточна позиція водія, [lng, lat].
 */
export async function optimizeRoute(
  start: [number, number],
  stops: OptimizeStop[],
  fuel: FuelParams,
  maxDetour: number = DEFAULT_MAX_DETOUR,
  direction: Direction = "nearest"
): Promise<OptimizeResult> {
  if (stops.length === 0) {
    throw new Error("Немає точок для оптимізації");
  }

  const coords: [number, number][] = [start, ...stops.map((s) => [s.lng, s.lat] as [number, number])];

  // Одна точка — оптимізувати нічого, але маршрут усе одно потрібен.
  if (stops.length === 1) {
    const route = await getRoute(coords);
    const variant: RouteVariant = {
      order: [stops[0].id],
      distanceKm: route.totalDistanceKm,
      durationMin: route.totalDurationMin,
      fuelCost: fuelCostFor(route.totalDistanceKm, fuel),
      geometry: route.geometry,
      priorityScore: orderQuality(stops),
    };
    return { cheapest: variant, balanced: null, detourPercent: 0 };
  }

  const trip = await getOptimalTrip(coords);

  /**
   * OSRM повертає waypoint_index — НОВУ позицію кожної точки у
   * впорядкованому маршруті, а не «яка точка стоїть на цьому місці».
   * Плутанина між цими двома трактуваннями — класична причина маршрутів,
   * що виглядають випадковими, тому розгортаємо явно.
   */
  const ordered: OptimizeStop[] = [];
  trip.waypointOrder.forEach((newPos, originalIdx) => {
    // 0 — це start, зупинки починаються з 1
    if (originalIdx === 0) return;
    ordered[newPos - 1] = stops[originalIdx - 1];
  });
  let cheapestOrder = ordered.filter(Boolean);
  let cheapestKm = trip.totalDistanceKm;
  let cheapestMin = trip.totalDurationMin;
  let cheapestGeometry: GeoJSON.LineString | null = trip.geometry;

  // «Спершу дальні» — це не нова оптимізація, а той самий найкоротший
  // ланцюжок у зворотному напрямку. Кілометраж при цьому інший (перший
  // перегін — одразу в найдальшу точку), тому цифри перераховує OSRM по
  // реальному порядку, а не беруться з прямого варіанта.
  if (direction === "farthest" && cheapestOrder.length > 1) {
    const reversed = [...cheapestOrder].reverse();
    const route = await getRoute([start, ...reversed.map((s) => [s.lng, s.lat] as [number, number])]);
    cheapestOrder = reversed;
    cheapestKm = route.totalDistanceKm;
    cheapestMin = route.totalDurationMin;
    cheapestGeometry = route.geometry;
  }

  const cheapest: RouteVariant = {
    order: cheapestOrder.map((s) => s.id),
    distanceKm: cheapestKm,
    durationMin: cheapestMin,
    fuelCost: fuelCostFor(cheapestKm, fuel),
    geometry: cheapestGeometry,
    priorityScore: orderQuality(cheapestOrder),
  };

  const balancedRaw = await balanceOrder(start, stops, cheapestOrder, cheapestKm, maxDetour);

  if (!balancedRaw) {
    return { cheapest, balanced: null, detourPercent: 0 };
  }

  const balanced: RouteVariant = {
    order: balancedRaw.order.map((s) => s.id),
    distanceKm: balancedRaw.distanceKm,
    durationMin: balancedRaw.durationMin,
    fuelCost: fuelCostFor(balancedRaw.distanceKm, fuel),
    geometry: balancedRaw.geometry,
    priorityScore: orderQuality(balancedRaw.order),
  };

  const detourPercent =
    cheapest.distanceKm > 0
      ? Math.round(((balanced.distanceKm - cheapest.distanceKm) / cheapest.distanceKm) * 1000) / 10
      : 0;

  return { cheapest, balanced, detourPercent };
}
