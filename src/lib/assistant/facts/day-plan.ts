/**
 * План дня як МАРШРУТ, а не як список боржників.
 *
 * Стара відповідь брала десять найтерміновіших справ і видавала їх
 * підряд — Стрий, Львів, Самбір, знову Стрий. Виконати такий «план» за
 * день неможливо: між першою й другою точкою сто кілометрів, і торговий
 * однаково їде по-своєму, тобто планом не користується.
 *
 * Тому тут три речі, яких там не було.
 *
 * НАПРЯМОК. Кандидати збиваються в купки по відстані. День — це один
 * напрямок, а не найкращі точки з усієї області.
 *
 * ЧИ Є ЧИМ ТОРГУВАТИ. По кожному напрямку видно, що ці клієнти беруть
 * регулярно, і чи це є на складі. Їхати за сто кілометрів до чотирьох
 * магазинів, яким потрібна піна, коли піни немає, — гірше, ніж не їхати:
 * час витрачено, а привід зайти зіпсовано.
 *
 * ПОРЯДОК. Обраний напрямок вишиковується через OSRM в один бік. Якщо
 * OSRM мовчить, лишається порядок за відстанню від старту — гірше, але
 * все одно не різнобій.
 */

import { prisma } from "@/lib/prisma";
import { SOURCE_FILTER } from "@/lib/analytics/facts";
import { FREE_STOCK_ALL } from "@/lib/assistant/facts/sql";
import { dayRouteCandidates } from "@/lib/assistant/facts/day-candidates";
import { distanceKm } from "@/lib/assistant/facts/nearby";
import { getOptimalTrip } from "@/lib/geo/osrm";

/** Радіус купки, км. Далі — це вже інший виїзд. */
const CLUSTER_KM = 25;

/** Скільки днів історії беремо, щоб зрозуміти, чим торгують на напрямку. */
const GOODS_WINDOW_DAYS = 180;

/** Скільки ключових товарів показуємо по напрямку. */
const GOODS_LIMIT = 6;

type Candidate = Awaited<ReturnType<typeof dayRouteCandidates>>["кандидати"][number];

/**
 * Точка плану. Координати не в усіх: у 17% контрагентів піна на карті
 * немає взагалі, а в портфелі окремого торгового буває й третина.
 * Викидати їх не можна — це живі клієнти з боргом; тому вони чіпляються
 * до напрямку за МІСТОМ з адреси й показуються хвостом, без порядку
 * обʼїзду.
 */
type Stop = Candidate & { lat: number | null; lng: number | null; city: string | null };
type Placed = Stop & { lat: number; lng: number };

export type DirectionGood = {
  productId: string;
  name: string;
  sku: string | null;
  /** Скільки клієнтів напрямку його беруть. */
  clients: number;
  /** Типове замовлення, шт. */
  perOrder: number;
  free: number;
  /** Вільного залишку не вистачить навіть на половину напрямку. */
  short: boolean;
  /** Останній прихід і типовий проміжок між приходами. */
  lastArrival: Date | null;
  arrivalEveryDays: number | null;
};

export type PlanDirection = {
  key: string;
  name: string;
  /** Точки з координатами — саме вони шикуються в маршрут. */
  stops: Placed[];
  /** Клієнти напрямку без точки на карті: у порядок не стають. */
  loose: Stop[];
  overdue: number;
  debt: number;
  habitual: number;
  goods: DirectionGood[];
  short: DirectionGood[];
  score: number;
};

export type RouteOrder = {
  order: Placed[];
  km: number | null;
  minutes: number | null;
  source: "osrm" | "відстань";
};

export type DayPlan = {
  day: string;
  weekday: string;
  routeName: string | null;
  /** Кандидати, яких не вдалося прив'язати навіть за містом. */
  unplaced: Stop[];
  directions: PlanDirection[];
  chosen: PlanDirection | null;
  /** Чому обрали не найтерміновіший напрямок. */
  moved: { direction: PlanDirection; reason: string } | null;
  route: RouteOrder | null;
  note: string;
};

export async function planDay(repId: string, day: string, limit = 30): Promise<DayPlan> {
  const base = await dayRouteCandidates(repId, day, limit);

  const ids = base.кандидати.map((c) => c.клієнт_id);
  const [geo, start] = await Promise.all([
    prisma.counterparty.findMany({
      where: { id: { in: ids } },
      select: { id: true, deliveryLat: true, deliveryLng: true, address: true },
    }),
    prisma.trackPoint.findFirst({
      where: { userId: repId },
      orderBy: { recordedAt: "desc" },
      select: { lat: true, lng: true },
    }),
  ]);

  const geoById = new Map(geo.map((g) => [g.id, g]));

  /**
   * Міста, які ми вже бачили в адресах цього дня.
   *
   * Потрібні, бо в 1С місто часто стоїть у НАЗВІ контрагента, а не в
   * адресі: «Скуратов Юрій (Львів)», «Кузьо Андрій (м.Самбір)». Шукати в
   * назві будь-яке слово з великої не можна — «Пац Валентин (торговий)»
   * перетворився б на місто «Торговий». А от звірити з переліком міст,
   * які вже трапилися в адресах, безпечно.
   */
  const knownCities = new Set<string>();
  for (const g of geo) {
    const city = cityOf(g.address);
    if (city) knownCities.add(city);
  }

  const placed: Placed[] = [];
  const homeless: Stop[] = [];
  for (const c of base.кандидати) {
    const g = geoById.get(c.клієнт_id);
    const city = cityOf(g?.address ?? c.адреса ?? null) ?? cityInName(c.назва, knownCities);
    if (g?.deliveryLat != null && g.deliveryLng != null) {
      placed.push({ ...c, lat: g.deliveryLat, lng: g.deliveryLng, city });
    } else {
      homeless.push({ ...c, lat: null, lng: null, city });
    }
  }

  const clusters = clusterByDistance(placed);

  /**
   * Клієнт без координат чіпляється до напрямку за містом.
   *
   * Інакше третина портфеля просто зникала б із плану — а серед них ті,
   * до кого їхати найпотрібніше: нові точки, яких ще ніхто не геокодував.
   */
  const cityToCluster = new Map<string, number>();
  clusters.forEach((cluster, i) => {
    for (const s of cluster) if (s.city && !cityToCluster.has(s.city)) cityToCluster.set(s.city, i);
  });

  const loose: Stop[][] = clusters.map(() => []);
  const unplaced: Stop[] = [];
  const byCity = new Map<string, Stop[]>();
  for (const c of homeless) {
    const idx = c.city ? cityToCluster.get(c.city) : undefined;
    if (idx != null) {
      loose[idx].push(c);
      continue;
    }
    if (!c.city) {
      unplaced.push(c);
      continue;
    }
    /**
     * Місто без жодної координати — теж напрямок.
     *
     * Інакше цілий Стрий випадав би з плану лише тому, що жодного з
     * тамтешніх магазинів ще не геокодували: напрямок є, товар для нього
     * порахувати можна, і не порахувати його — гірше, ніж порахувати без
     * порядку обʼїзду.
     */
    const list = byCity.get(c.city) ?? [];
    list.push(c);
    byCity.set(c.city, list);
  }

  for (const [city, list] of byCity) {
    clusters.push([]);
    loose.push(list);
    cityToCluster.set(city, clusters.length - 1);
  }

  const goodsByClient = await directionGoods([
    ...placed.map((p) => p.клієнт_id),
    ...homeless.map((p) => p.клієнт_id),
  ]);

  const directions: PlanDirection[] = [];
  for (const [i, stops] of clusters.entries()) {
    const all = [...stops, ...loose[i]];
    const goods = summarizeGoods(all, goodsByClient);
    const overdue = all.reduce((s, c) => s + c.прострочено, 0);
    const habitual = all.filter((c) => c.звичний_для_дня).length;
    directions.push({
      key: `dir-${i + 1}`,
      name: stops.length ? directionName(stops, geoById) : (loose[i][0]?.city ?? "без міста"),
      stops,
      loose: loose[i],
      overdue,
      debt: all.reduce((s, c) => s + c.борг, 0),
      habitual,
      goods,
      short: goods.filter((g) => g.short),
      /**
       * Вага напрямку. Звичка важить найбільше: клієнти чекають торгового
       * саме в цей день, і поїздка «не за розкладом» ламає їхнє планування
       * так само, як і його.
       */
      score: habitual * 8 + all.length * 2 + Math.min(20, overdue / 10_000),
    });
  }

  // Залишки — одним запитом на всі напрямки: саме вони вирішують, куди їхати.
  await fillStock(directions);

  directions.sort((a, b) => b.score - a.score);

  const arrivals = await arrivalStats(
    directions.flatMap((d) => d.short.map((g) => g.productId))
  );
  for (const d of directions) {
    for (const g of d.goods) {
      const a = arrivals.get(g.productId);
      g.lastArrival = a?.last ?? null;
      g.arrivalEveryDays = a?.everyDays ?? null;
    }
  }

  /**
   * Обираємо напрямок: найвагоміший, але лише якщо там є чим торгувати.
   *
   * «Є чим» — це не «є все». Порожній склад по одній позиції з шести не
   * скасовує виїзд; двох і більше вже досить, щоб день вийшов порожнім.
   *
   * І заміна мусить бути СПІВМІРНОЮ. Перший прогін на бойових віддав
   * замість Львова з шістьма точками одного клієнта в Самборі за
   * дев'яносто кілометрів — формально «там товар є», фактично це не день
   * роботи. Тому заміна береться лише з напрямків, де точок хоча б
   * половина від лідера.
   */
  const enough = (d: PlanDirection) => d.short.length < 2;
  const size = (d: PlanDirection) => d.stops.length + d.loose.length;
  const first = directions[0] ?? null;

  let chosen = first;
  if (first && !enough(first)) {
    const replacement = directions.find(
      (d) => d.key !== first.key && enough(d) && size(d) >= Math.max(2, Math.ceil(size(first) / 2))
    );
    if (replacement) chosen = replacement;
  }

  const moved =
    first && chosen && chosen.key !== first.key
      ? {
          direction: first,
          reason: `на складі немає ${first.short
            .map((g) => g.name.split(" ").slice(0, 3).join(" "))
            .slice(0, 3)
            .join(", ")}`,
        }
      : null;

  const route = chosen ? await orderStops(chosen.stops, start) : null;

  return {
    day,
    weekday: base.день_тижня,
    routeName: base.маршрут_за_розкладом?.назва ?? null,
    unplaced,
    directions,
    chosen,
    moved,
    route,
    note: base.примітка,
  };
}

/* ── Купки ────────────────────────────────────────────────────────────── */

/**
 * Жадібна кластеризація: найтерміновіший стає ядром, до нього збирається
 * все ближче за CLUSTER_KM.
 *
 * Не k-means: кількість напрямків заздалегідь невідома, а результат має
 * бути стабільним — торговий двічі питає план на той самий день і має
 * побачити той самий поділ.
 */
function clusterByDistance(points: Placed[]): Placed[][] {
  const rest = [...points];
  const clusters: Placed[][] = [];

  while (rest.length > 0) {
    const seed = rest.shift()!;
    const cluster = [seed];
    for (let i = rest.length - 1; i >= 0; i--) {
      if (distanceKm(seed, rest[i]) <= CLUSTER_KM) cluster.push(...rest.splice(i, 1));
    }
    clusters.push(cluster);
  }

  return clusters;
}

/** Назва напрямку — найчастіше місто серед адрес купки. */
function directionName(
  stops: Placed[],
  geo: Map<string, { address: string | null }>
): string {
  const counts = new Map<string, number>();
  for (const s of stops) {
    const city = cityOf(geo.get(s.клієнт_id)?.address ?? null);
    if (!city) continue;
    counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return `${stops.length} точок`;
  return counts.size > 1 ? `${top[0]} і поруч` : top[0];
}

/**
 * Місто з адреси 1С.
 *
 * Формат там людський, а не структурований: «м.Стрий, вул.Обаля 2»,
 * «79053, Львівська обл., м. Львів, вул. Музики». Беремо перший шматок із
 * «м.» або «с.», інакше — перше слово з великої літери.
 */
function cityOf(address: string | null): string | null {
  if (!address) return null;
  // Дефіс усередині назви — частина міста: «Рава-Руська», «Івано-Франківськ».
  const CITY = "[А-ЯІЇЄҐ][а-яіїєґ'ʼ]+(?:-[А-ЯІЇЄҐа-яіїєґ]+)?";
  const marked = new RegExp(`(?:^|[,\\s])(?:м|с|смт)\\.?\\s*(${CITY})`).exec(address);
  if (marked) return marked[1];
  const first = new RegExp(`(${CITY})`).exec(address);
  return first?.[1] ?? null;
}

/** Місто, заховане в назві контрагента, — лише з уже відомих. */
function cityInName(name: string, known: Set<string>): string | null {
  const marked = cityOf(name);
  if (marked && known.has(marked)) return marked;
  for (const city of known) {
    if (name.includes(city)) return city;
  }
  return marked;
}

/* ── Чим торгувати ────────────────────────────────────────────────────── */

type ClientGood = {
  counterpartyId: string;
  productId: string;
  name: string;
  sku: string | null;
  docs: number;
  qty: number;
};

async function directionGoods(clientIds: string[]): Promise<Map<string, ClientGood[]>> {
  if (clientIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<ClientGood[]>`
    SELECT
      s."counterpartyId" AS "counterpartyId",
      i."productId" AS "productId",
      p.name, p.sku,
      COUNT(DISTINCT s.id)::int AS docs,
      SUM(i.quantity)::float AS qty
    FROM "SalesDocumentItem" i
    JOIN "SalesDocument" s ON s.id = i."salesDocumentId"
    JOIN "Product" p ON p.id = i."productId"
    WHERE ${SOURCE_FILTER}
      AND s."docType" = 'REALIZATION'
      AND s."counterpartyId" = ANY(${clientIds}::text[])
      AND s."createdAt" >= NOW() - (${GOODS_WINDOW_DAYS} * INTERVAL '1 day')
    GROUP BY 1, 2, 3, 4
    HAVING COUNT(DISTINCT s.id) >= 2
  `;

  const byClient = new Map<string, ClientGood[]>();
  for (const r of rows) {
    const list = byClient.get(r.counterpartyId) ?? [];
    list.push(r);
    byClient.set(r.counterpartyId, list);
  }
  return byClient;
}

function summarizeGoods(stops: Stop[], byClient: Map<string, ClientGood[]>): DirectionGood[] {
  const agg = new Map<string, DirectionGood & { docs: number; qty: number }>();

  for (const stop of stops) {
    for (const g of byClient.get(stop.клієнт_id) ?? []) {
      const acc = agg.get(g.productId) ?? {
        productId: g.productId,
        name: g.name,
        sku: g.sku,
        clients: 0,
        perOrder: 0,
        free: 0,
        short: false,
        lastArrival: null,
        arrivalEveryDays: null,
        docs: 0,
        qty: 0,
      };
      acc.clients += 1;
      acc.docs += g.docs;
      acc.qty += g.qty;
      agg.set(g.productId, acc);
    }
  }

  return [...agg.values()]
    .sort((a, b) => b.clients - a.clients || b.docs - a.docs)
    .slice(0, GOODS_LIMIT)
    .map((g) => ({
      productId: g.productId,
      name: g.name,
      sku: g.sku,
      clients: g.clients,
      perOrder: Math.max(1, Math.round(g.qty / Math.max(1, g.docs))),
      free: 0,
      short: false,
      lastArrival: null,
      arrivalEveryDays: null,
    }));
}

/** Вільний залишок для ключових товарів усіх напрямків одним запитом. */
async function fillStock(directions: PlanDirection[]): Promise<void> {
  const ids = [...new Set(directions.flatMap((d) => d.goods.map((g) => g.productId)))];
  if (ids.length === 0) return;

  const rows = await prisma.$queryRaw<Array<{ productId: string; free: number }>>`
    WITH ${FREE_STOCK_ALL}
    SELECT fs."productId", fs.free
    FROM free_stock fs
    WHERE fs."productId" = ANY(${ids}::text[])
  `;
  const freeById = new Map(rows.map((r) => [r.productId, r.free]));

  for (const d of directions) {
    for (const g of d.goods) {
      g.free = Math.round(freeById.get(g.productId) ?? 0);
      /**
       * «Мало» — це менше, ніж одне типове замовлення на кожного другого
       * клієнта напрямку. Порожній залишок і залишок «на одного» однаково
       * не дають поїхати з товаром до чотирьох магазинів.
       */
      g.short = g.free < g.perOrder * Math.max(1, Math.ceil(g.clients / 2));
    }
    d.short = d.goods.filter((g) => g.short);
  }
}

/* ── Коли буде товар ──────────────────────────────────────────────────── */

type ArrivalRow = { productId: string; last: Date; gaps: number[] };

/**
 * Оцінка наступного приходу з історії надходжень.
 *
 * Майбутніх поставок 1С не передає — у базі лише те, що вже приїхало.
 * Тому це саме ОЦІНКА: остання дата плюс типовий проміжок між приходами.
 * Обіцяти нею клієнту не можна, а планувати свій тиждень — цілком.
 */
async function arrivalStats(
  productIds: string[]
): Promise<Map<string, { last: Date; everyDays: number | null }>> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return new Map();

  const rows = await prisma.$queryRaw<Array<{ productId: string; at: Date }>>`
    SELECT i."productId" AS "productId", po."createdAt" AS at
    FROM "PurchaseOrderItem" i
    JOIN "PurchaseOrder" po ON po.id = i."purchaseOrderId"
    WHERE i."productId" = ANY(${ids}::text[])
      AND po."createdAt" >= NOW() - INTERVAL '365 days'
    ORDER BY i."productId", po."createdAt" DESC
  `;

  const byProduct = new Map<string, Date[]>();
  for (const r of rows) {
    const list = byProduct.get(r.productId) ?? [];
    if (list.length < 12) list.push(r.at);
    byProduct.set(r.productId, list);
  }

  const out = new Map<string, { last: Date; everyDays: number | null }>();
  for (const [productId, dates] of byProduct) {
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const days = (dates[i - 1].getTime() - dates[i].getTime()) / 86_400_000;
      if (days >= 0.5) gaps.push(days);
    }
    gaps.sort((a, b) => a - b);
    out.set(productId, {
      last: dates[0],
      everyDays: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : null,
    });
  }
  return out;
}

/* ── Порядок обʼїзду ──────────────────────────────────────────────────── */

export async function orderStops<T extends { lat: number; lng: number }>(
  stops: T[],
  start: { lat: number; lng: number } | null
): Promise<{ order: T[]; km: number | null; minutes: number | null; source: "osrm" | "відстань" } | null> {
  if (stops.length === 0) return null;

  const from = start ?? stops[0];

  if (stops.length === 1) {
    return { order: stops, km: null, minutes: null, source: "відстань" };
  }

  try {
    const coords: [number, number][] = [
      [from.lng, from.lat],
      ...stops.map((s) => [s.lng, s.lat] as [number, number]),
    ];
    const trip = await getOptimalTrip(coords);

    const ordered: T[] = [];
    trip.waypointOrder.forEach((newPos, originalIdx) => {
      if (originalIdx === 0) return; // нульова точка — старт
      ordered[newPos - 1] = stops[originalIdx - 1];
    });

    const clean = ordered.filter(Boolean);
    if (clean.length === stops.length) {
      return { order: clean, km: trip.totalDistanceKm, minutes: trip.totalDurationMin, source: "osrm" };
    }
  } catch {
    // OSRM недоступний — нижче резервний порядок.
  }

  /**
   * Резерв: від старту до найдальшої точки.
   *
   * Не оптимально, зате в один бік: торговий їде від себе вглиб напрямку
   * й повертається, а не стрибає туди-сюди.
   */
  const sorted = [...stops].sort((a, b) => distanceKm(from, a) - distanceKm(from, b));
  return { order: sorted, km: null, minutes: null, source: "відстань" };
}
