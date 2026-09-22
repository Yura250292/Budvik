/**
 * Кого якому водію і що відкласти: ядро планування дня.
 *
 * Чиста функція — без бази, без мережі, без `next/*`. Причина не в красі:
 * рішення «Коваль їде до Піцишина, а Турка чекає четверга» людина має
 * змогу відтворити й оскаржити, а відтворити можна лише те, що не залежить
 * від того, що відповів OSRM о 19:40.
 *
 * Кілометрів тут немає СВІДОМО. Грона будуються по прямій від складу, і це
 * чесно названо: справжню дорогу знає тільки OSRM, і саме він рахує порядок
 * та відстані потім, у роуті. Прямої досить, щоб зрозуміти, що Турка й
 * Борислав — один бік, а Броди — інший; рахувати нею кілометраж не можна.
 *
 * Порядок точок усередині маршруту ядро не визначає: це робота optimize.ts,
 * яка коштує запитів до OSRM і має свої два варіанти вибору.
 *
 * Типи профілів і ключ пари живуть ТУТ, а не в delivery-habits: той модуль
 * тягне Prisma, і ядро, імпортуючи з нього хоч одну функцію, перестало б
 * запускатися без бази — разом зі своїм тестом.
 */

import { CorridorIndex } from "@/lib/routes/corridor";
import { haversineM } from "@/lib/track/geo";

/** Скільки разів водій возив цього клієнта. Профілі заповнює delivery-habits. */
export type DriverHabit = { driverId: string; count: number };

/** З якої кількості спільних поїздок пара клієнтів вважається стійкою. */
export const PAIR_MIN = 5;

/**
 * Ключ пари, незалежний від порядку.
 *
 * Пара «Коваль і Гевко» та «Гевко і Коваль» — одна пара; без сортування
 * лічильник роздвоївся б, і жодна пара не дотягнула б до порога.
 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export type PlanPoint = {
  /** salesDocumentId — саме він потім стане точкою маршруту */
  id: string;
  counterpartyId: string;
  name: string;
  lat: number;
  lng: number;
  /** Сума накладної, ₴ */
  amount: number;
  /** 0..1 з priority.ts: борг, оборот, стан клієнта. Рахує викликач */
  score: number;
  /** Менеджер закріпив точку за водієм — їде попри будь-яку арифметику */
  pinnedDriverId: string | null;
};

export type PlanDriver = {
  id: string;
  name: string;
  /** Межа дня з історії (delivery-habits) або дефолт */
  maxStops: number;
};

export type PlanHabits = {
  driverByClient: Map<string, DriverHabit[]>;
  weekdayByClient: Map<string, number[]>;
  pairs: Map<string, number>;
};

export type PlanOptions = {
  /** Ширина грона: точка далі цього від осі «склад → якір» іде в інше гроно */
  clusterRadiusKm: number;
  /**
   * Радіус міського грона навколо складу, км.
   *
   * CorridorIndex.distanceKm міряє відстань до ВІДРІЗКА «склад → якір», а не
   * до складу, і точка біля самого складу завжди лежить за кілька
   * кілометрів від його ПОЧАТКУ. Без окремого міського кроку всі міські
   * точки чіплялися б до грона першого-ліпшого далекого якоря — і міська
   * розвозка поїхала б у Турку разом з далекою точкою.
   */
  cityRadiusKm: number;
  /** З якої відстані від складу гроно вважається далеким */
  farKm: number;
  /** Скільки грошей має бути в далекому гроні, щоб рейс окупився */
  minFarAmount: number;
};

/**
 * Числа підібрані по історії 139 листів: середній розтяг листа 74 км, у
 * місті точки стоять щільно, а далекі напрямки (Турка, Броди) відходять
 * від складу на 60–90 км. 12 км ширини — це смуга, у якій водій справді
 * заїжджає «по дорозі», не роблячи окремого рейсу. 15 км міського радіуса —
 * межа, за якою забудова Львова закінчується і починається виїзд.
 */
export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  clusterRadiusKm: 12,
  cityRadiusKm: 15,
  farKm: 45,
  minFarAmount: 15_000,
};

export type PlanCluster = {
  points: PlanPoint[];
  /** Відстань по прямій від складу до найдальшої точки грона, км */
  anchorKm: number;
  amount: number;
};

export type PlanRoute = {
  driverId: string;
  points: PlanPoint[];
  /** Чому саме цей водій — рядок, який побачить менеджер */
  reason: string;
};

export type DeferredCluster = {
  points: PlanPoint[];
  reason: string;
  /** Найчастіший день тижня цих точок в історії, 0 = понеділок; null — історії немає */
  suggestWeekday: number | null;
};

export type DayPlan = {
  routes: PlanRoute[];
  deferred: DeferredCluster[];
};

export type PlanInput = {
  points: PlanPoint[];
  drivers: PlanDriver[];
  habits: PlanHabits;
  depot: { lat: number; lng: number };
  options: PlanOptions;
  /** День тижня, на який плануємо, 0 = понеділок. Потрібен для поради «зазвичай їде в…» */
  weekday: number;
};

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineM(a.lat, a.lng, b.lat, b.lng) / 1000;
}

/**
 * Грона «по дорозі»: найдальша точка задає напрямок, решта чіпляється до осі.
 *
 * Чому від найдальшої, а не кластеризацією загального вигляду: рейс завжди
 * має вістря — точку, заради якої виїжджають, — і все, що по дорозі до неї,
 * дістається безкоштовно. k-means такого поняття не має і порізав би
 * напрямок на «ближню» й «дальню» половини, тобто на два рейси однією дорогою.
 *
 * Перший крок — окреме міське гроно: усі точки в межах `cityRadiusKm` від
 * складу стають ОДНИМ гроном одразу, ще до того, як з решти обираються
 * далекі якорі (див. коментар при `cityRadiusKm` — чому без цього кроку
 * місто чіплялось би до випадкового далекого напрямку).
 */
export function clusterPoints(
  points: PlanPoint[],
  depot: { lat: number; lng: number },
  radii: { clusterRadiusKm: number; cityRadiusKm: number }
): PlanCluster[] {
  const { clusterRadiusKm, cityRadiusKm } = radii;

  const city: PlanPoint[] = [];
  const rest: PlanPoint[] = [];
  for (const p of points) {
    (km(depot, p) <= cityRadiusKm ? city : rest).push(p);
  }

  const clusters: PlanCluster[] = [];
  if (city.length > 0) {
    clusters.push({
      points: city,
      anchorKm: Math.max(...city.map((p) => km(depot, p))),
      amount: city.reduce((s, p) => s + p.amount, 0),
    });
  }

  const left = [...rest].sort((a, b) => km(depot, b) - km(depot, a));
  while (left.length > 0) {
    const anchor = left.shift()!;
    const anchorKm = km(depot, anchor);
    const axis = new CorridorIndex([depot, { lat: anchor.lat, lng: anchor.lng }]);

    const taken: PlanPoint[] = [anchor];
    for (let i = left.length - 1; i >= 0; i--) {
      const p = left[i];
      // Не далі смуги вздовж осі — і не за якорем: те, що лежить далі
      // вістря, належить наступному, ще дальшому напрямку.
      if (axis.distanceKm(p) <= clusterRadiusKm && km(depot, p) <= anchorKm + clusterRadiusKm) {
        taken.push(p);
        left.splice(i, 1);
      }
    }

    clusters.push({
      points: taken,
      anchorKm,
      amount: taken.reduce((s, p) => s + p.amount, 0),
    });
  }

  return clusters;
}

/** Наскільки гроно «своє» для водія: сума доставок його клієнтам в історії. */
function affinity(cluster: PlanPoint[], driverId: string, habits: PlanHabits): number {
  let total = 0;
  for (const p of cluster) {
    const list = habits.driverByClient.get(p.counterpartyId);
    if (!list) continue;
    total += list.find((h) => h.driverId === driverId)?.count ?? 0;
  }
  return total;
}

/** Найчастіший день тижня точок грона; null — історії немає. */
function usualWeekday(cluster: PlanPoint[], habits: PlanHabits): number | null {
  const sum = [0, 0, 0, 0, 0, 0, 0];
  let seen = false;
  for (const p of cluster) {
    const week = habits.weekdayByClient.get(p.counterpartyId);
    if (!week) continue;
    seen = true;
    for (let i = 0; i < 7; i++) sum[i] += week[i];
  }
  if (!seen) return null;
  let best = 0;
  for (let i = 1; i < 7; i++) if (sum[i] > sum[best]) best = i;
  return sum[best] > 0 ? best : null;
}

/**
 * Порядок, у якому точки грона віддаються водію, коли гроно не влазить цілком.
 *
 * Спершу ті, що в стійких парах із уже взятими, — щоб розрив пройшов між
 * чужими одна одній точками, а не посеред села, яке водій завжди об'їжджає
 * разом. Далі — за грошима й важливістю.
 */
function splitOrder(points: PlanPoint[], habits: PlanHabits): PlanPoint[] {
  const scored = points.map((p) => {
    let pairWeight = 0;
    for (const other of points) {
      if (other.id === p.id) continue;
      const n = habits.pairs.get(pairKey(p.counterpartyId, other.counterpartyId)) ?? 0;
      if (n >= PAIR_MIN) pairWeight += n;
    }
    return { p, pairWeight };
  });

  return scored
    .sort((a, b) => b.pairWeight - a.pairWeight || b.p.amount - a.p.amount || b.p.score - a.p.score)
    .map((s) => s.p);
}

export function planDay(input: PlanInput): DayPlan {
  const { points, drivers, habits, depot, options } = input;

  const routes = new Map<string, PlanRoute>();
  for (const d of drivers) {
    routes.set(d.id, { driverId: d.id, points: [], reason: "" });
  }
  const free = new Map(drivers.map((d) => [d.id, d.maxStops]));
  const deferred: DeferredCluster[] = [];

  /* ── Закріплені точки — поза будь-якою арифметикою ─────────────────── */

  const rest: PlanPoint[] = [];
  for (const p of points) {
    const route = p.pinnedDriverId ? routes.get(p.pinnedDriverId) : undefined;
    if (route) {
      route.points.push(p);
      free.set(route.driverId, (free.get(route.driverId) ?? 0) - 1);
      route.reason = route.reason || "закріплено менеджером";
    } else {
      rest.push(p);
    }
  }

  /* ── Грона: дорожчі першими ─────────────────────────────────────────── */

  const clusters = clusterPoints(rest, depot, options).sort((a, b) => b.amount - a.amount);

  for (const cluster of clusters) {
    const far = cluster.anchorKm > options.farKm;
    if (far && cluster.amount < options.minFarAmount) {
      deferred.push({
        points: cluster.points,
        reason: `${cluster.points.length} точ. на ${Math.round(cluster.amount).toLocaleString("uk-UA")} ₴ за ${Math.round(cluster.anchorKm)} км по прямій — рейс не окупиться`,
        suggestWeekday: usualWeekday(cluster.points, habits),
      });
      continue;
    }

    // Водії за спорідненістю, далі за вільним місцем: коли історії немає
    // (новий напрямок), вирішує той, у кого день вільніший.
    const ranked = [...drivers].sort((a, b) => {
      const affDiff = affinity(cluster.points, b.id, habits) - affinity(cluster.points, a.id, habits);
      if (affDiff !== 0) return affDiff;
      return (free.get(b.id) ?? 0) - (free.get(a.id) ?? 0);
    });

    let left = splitOrder(cluster.points, habits);

    for (const driver of ranked) {
      if (left.length === 0) break;
      const room = free.get(driver.id) ?? 0;
      if (room <= 0) continue;

      const take = left.slice(0, room);
      left = left.slice(room);

      const route = routes.get(driver.id)!;
      route.points.push(...take);
      free.set(driver.id, room - take.length);

      const aff = affinity(take, driver.id, habits);
      const line = aff > 0 ? `${aff} доставок цим клієнтам в історії` : "вільний день, історії по цих клієнтах немає";
      route.reason = route.reason ? `${route.reason}; ${line}` : line;
    }

    if (left.length > 0) {
      deferred.push({
        points: left,
        reason: "денна межа водіїв вичерпана",
        suggestWeekday: usualWeekday(left, habits),
      });
    }
  }

  return {
    routes: [...routes.values()].filter((r) => r.points.length > 0),
    deferred,
  };
}
