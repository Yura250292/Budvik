/**
 * Точки на сьогодні для планшета водія.
 *
 * Джерел два, і вони не рівноцінні:
 *
 *   DeliveryRoute (сайт) — головне і, як з'ясувалося, єдине можливе
 *   джерело. Логіст формує маршрут у планувальнику, водій виконує його
 *   тут.
 *
 *   RouteSheet (1С) — запасне, майже напевно мертве. Доведено серією проб
 *   (коміти fe9debc, 2c8591e): 1С не знає, яку накладну повіз який водій.
 *   Табличної частини в Документ.МаршрутнийЛист немає, реквізиту
 *   «МаршрутнийЛист» у реалізацій немає, а Ответственный у них — комірник,
 *   один на всі документи. Список клієнтів формується ВРУЧНУ під час
 *   друку і ніде не зберігається. Гілка лишається на випадок, якщо в 1С
 *   колись з'явиться те, чого там зараз нема.
 *
 * Порядок саме такий: спершу маршрут сайту, і лише якщо його немає —
 * маршрутний лист. Зворотний порядок означав би, що порожній лист із 1С
 * перекриває реальний маршрут, складений логістом.
 *
 * Беремо перше непорожнє. Порожній результат — не помилка: планшет
 * показує банер «маршрут ще не синхронізовано», а водій усе одно бачить
 * карту й може відмітити візит поза планом.
 *
 * Координати НЕ дублюються в точку маршруту: вони завжди беруться з
 * картки контрагента, щоб уточнений пін одразу відбивався на всіх
 * майбутніх маршрутах, а не лише на тих, що створені після уточнення.
 */

import { prisma } from "@/lib/prisma";
import { kyivDate, kyivDayEnd, kyivDayStart } from "@/lib/date/kyiv";

/** Відмітка, приклеєна до точки маршруту. */
export type StopVisit = {
  status: string;
  money: string;
  collectedAmount: number | null;
  comment: string | null;
};

export type DayStop = {
  /** Стабільний ключ рядка в UI */
  key: string;
  /**
   * Ключі всіх рядків, злитих у цю точку (включно з власним).
   *
   * На карті точка одна, а рядків у маршруті за тією самою адресою може
   * бути кілька. Збереження порядку має перенумерувати їх УСІ: інакше
   * прихований сусід лишається зі старим номером і в списку виглядає як
   * точка, що «кудись поділася».
   */
  mergedKeys: string[];
  counterpartyId: string | null;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** MANUAL — пін уточнили руками; CITY — точність лише до міста */
  geoSource: string | null;
  sequence: number;
  /** Сума документів на точці, ₴ */
  amount: number;
  /** Скільки боргу треба забрати, ₴ */
  debtAmount: number;
  /**
   * DELIVERY — звичайна доставка; PICKUP/ERRAND — бонусна поїздка без
   * накладної (забрати товар, пошта). Планшет ховає для них суми й
   * інкасацію: там нічого не везуть і нічого не забирають грішми.
   */
  kind: "DELIVERY" | "PICKUP" | "ERRAND";
  /** Примітка логіста до точки — водій читає її в розгорнутому рядку */
  notes: string | null;
  /**
   * Готова відмітка бонусної поїздки. Візит її нести не може: він
   * прив'язаний до клієнта, а поїздка «на пошту» клієнта не має. Тому для
   * PICKUP/ERRAND стан живе в самому DeliveryStop і приїжджає сюди.
   */
  ownVisit: StopVisit | null;
  routeSheetStopId: string | null;
  deliveryStopId: string | null;
};

export type DayRoute = {
  source: "ROUTE_SHEET" | "DELIVERY_ROUTE" | "NONE";
  /**
   * Ключ маршруту з префіксом джерела: `dr:<id>` або `rs:<id>`.
   *
   * Саме ним водій відкриває минулий або завтрашній лист — без нього
   * єдиною адресою дня була дата, а на одну дату маршрутів буває два.
   */
  id: string | null;
  /** Київська доба маршруту, YYYY-MM-DD. Дата відкритого листа, не «сьогодні». */
  day: string | null;
  /** Номер листа/маршруту — водій називає його диспетчеру */
  number: string | null;
  vehicle: string | null;
  /** Пробіг за планом (з 1С), км */
  plannedKm: number | null;
  /** GeoJSON LineString обраного маршруту — карта малює лінію плану */
  geometry: { type: string; coordinates: [number, number][] } | null;
  stops: DayStop[];
};

const EMPTY: DayRoute = {
  source: "NONE",
  id: null,
  day: null,
  number: null,
  vehicle: null,
  plannedKm: null,
  geometry: null,
  stops: [],
};

/**
 * Кілька рядків з тією самою адресою — одна точка на карті.
 *
 * Те саме правило, що в зарплаті (payroll-facts.ts дедуплікує точки за
 * унікальною адресою), і з тієї ж причини: водій приїхав туди один раз.
 * Суми складаються, щоб він бачив, скільки всього везе на цю адресу.
 */
function mergeByAddress(stops: DayStop[]): DayStop[] {
  const byKey = new Map<string, DayStop>();

  for (const s of stops) {
    // Бонусна поїздка ніколи не зливається: «забрати ремонт» за тією самою
    // адресою, куди їде доставка, — це окрема справа, і водій має бачити
    // її окремим рядком, інакше просто забуде.
    if (s.kind !== "DELIVERY") {
      byKey.set(s.key, { ...s, mergedKeys: [...s.mergedKeys] });
      continue;
    }

    // Контрагент надійніший за адресу (та сама точка буває записана
    // по-різному), адреса — запасний ключ для рядків без контрагента.
    const dedupKey =
      s.counterpartyId ?? (s.address ? `addr:${s.address.trim().toLowerCase()}` : s.key);

    const existing = byKey.get(dedupKey);
    if (!existing) {
      byKey.set(dedupKey, { ...s, mergedKeys: [...s.mergedKeys] });
      continue;
    }
    existing.amount += s.amount;
    existing.debtAmount += s.debtAmount;
    existing.sequence = Math.min(existing.sequence, s.sequence);
    existing.mergedKeys.push(...s.mergedKeys);
  }

  return [...byKey.values()].sort((a, b) => a.sequence - b.sequence);
}

/** Що треба підтягнути до листа 1С, щоб зібрати з нього точки дня. */
const SHEET_INCLUDE = {
  stops: {
    /**
     * Прибрана руками точка не їде водієві.
     *
     * Так її і задумували (див. RouteSheetStop.hidden у схемі), і саме так
     * її вже рахує зарплата (payroll-facts.ts). Тут фільтра не було: офіс
     * прибирав точку з листа, платити за неї переставали — а водій усе
     * одно бачив її в дні й міг поїхати.
     */
    where: { hidden: false },
    orderBy: { sequence: "asc" },
    include: {
      counterparty: {
        select: {
          id: true,
          name: true,
          address: true,
          deliveryAddress: true,
          deliveryLat: true,
          deliveryLng: true,
          geoSource: true,
        },
      },
    },
  },
} as const;

type SheetRecord = NonNullable<
  Awaited<ReturnType<typeof prisma.routeSheet.findFirst<{ include: typeof SHEET_INCLUDE }>>>
>;

/** Маршрутний лист 1С на цей день. */
async function fromRouteSheet(driverId: string, day: string): Promise<DayRoute | null> {
  const sheet = await prisma.routeSheet.findFirst({
    // Порожній лист пропускаємо: у 1С їх вистачає (шапка є, рядків немає), і
    // такий лист, узятий за номером першим, перекривав сусідній із точками —
    // водій бачив «маршруту немає» при живому маршруті.
    where: {
      driverId,
      date: { gte: kyivDayStart(day), lte: kyivDayEnd(day) },
      stops: { some: { hidden: false } },
    },
    orderBy: { number: "asc" },
    include: SHEET_INCLUDE,
  });

  return sheet ? mapRouteSheet(sheet) : null;
}

function mapRouteSheet(sheet: SheetRecord): DayRoute | null {
  if (sheet.stops.length === 0) return null;

  const stops: DayStop[] = sheet.stops.map((s, i) => ({
    key: `rs:${s.id}`,
    mergedKeys: [`rs:${s.id}`],
    counterpartyId: s.counterpartyId,
    name: s.counterparty?.name ?? s.address ?? "Без назви",
    address: s.address ?? s.counterparty?.deliveryAddress ?? s.counterparty?.address ?? null,
    lat: s.counterparty?.deliveryLat ?? null,
    lng: s.counterparty?.deliveryLng ?? null,
    geoSource: s.counterparty?.geoSource ?? null,
    sequence: s.sequence || i + 1,
    amount: s.amount,
    debtAmount: s.debtAmount,
    kind: "DELIVERY",
    notes: null,
    ownVisit: null,
    routeSheetStopId: s.id,
    deliveryStopId: null,
  }));

  return {
    source: "ROUTE_SHEET",
    id: `rs:${sheet.id}`,
    day: kyivDate(sheet.date),
    number: sheet.number,
    vehicle: sheet.vehicle,
    plannedKm: sheet.distanceKm || null,
    // Лист 1С геометрії не несе — лінія з'явиться після «Прокласти маршрут»
    geometry: null,
    stops: mergeByAddress(stops),
  };
}

const ROUTE_INCLUDE = {
  stops: {
    orderBy: { sequence: "asc" },
    include: {
      counterparty: {
        select: {
          id: true,
          name: true,
          address: true,
          deliveryAddress: true,
          deliveryLat: true,
          deliveryLng: true,
          geoSource: true,
          receivableBalance: true,
        },
      },
      salesDocument: { select: { totalAmount: true, number: true } },
    },
  },
} as const;

type RouteRecord = NonNullable<
  Awaited<ReturnType<typeof prisma.deliveryRoute.findFirst<{ include: typeof ROUTE_INCLUDE }>>>
>;

/**
 * Статуси, які водієві видно.
 *
 * PLANNED — чернетка логіста: він ще складає точки, і водієві її
 * показувати зарано. До появи статусу ASSIGNED планшет брав будь-який
 * PLANNED, і водій бачив недороблене. Виняток — сам логіст
 * (includePlanned): він оптимізує порядок точок саме в чернетці.
 */
export const DRIVER_VISIBLE_STATUSES = ["ASSIGNED", "IN_PROGRESS", "COMPLETED"] as const;

/** Плановий маршрут сайту на цей день. */
async function fromDeliveryRoute(
  driverId: string,
  day: string,
  includePlanned: boolean
): Promise<DayRoute | null> {
  const route = await prisma.deliveryRoute.findFirst({
    where: {
      driverId,
      date: { gte: kyivDayStart(day), lte: kyivDayEnd(day) },
      status: {
        in: includePlanned ? ["PLANNED", ...DRIVER_VISIBLE_STATUSES] : [...DRIVER_VISIBLE_STATUSES],
      },
      // Та сама причина, що й у листа нижче: маршрут без точок не має
      // перекривати той, у якому вони є.
      stops: { some: {} },
    },
    orderBy: { createdAt: "desc" },
    include: ROUTE_INCLUDE,
  });

  return route ? mapDeliveryRoute(route) : null;
}

function mapDeliveryRoute(route: RouteRecord): DayRoute | null {
  if (route.stops.length === 0) return null;

  const stops: DayStop[] = route.stops.map((s, i) => {
    const isErrand = s.kind !== "DELIVERY";

    return {
      key: `ds:${s.id}`,
      mergedKeys: [`ds:${s.id}`],
      counterpartyId: s.counterpartyId,
      // Бонусна поїздка звучить своєю назвою («Забрати ремонт»), а не
      // іменем клієнта: клієнта в ній може не бути взагалі.
      name: isErrand
        ? (s.title ?? "Додаткова поїздка")
        : (s.counterparty?.name ?? s.address ?? "Без назви"),
      address: s.address ?? s.counterparty?.deliveryAddress ?? s.counterparty?.address ?? null,
      // Своя координата — лише в точок без контрагента. Для доставки пін
      // завжди з картки клієнта, щоб уточнення відбивалося на всіх маршрутах.
      lat: s.counterparty?.deliveryLat ?? s.lat ?? null,
      lng: s.counterparty?.deliveryLng ?? s.lng ?? null,
      geoSource: s.counterparty?.geoSource ?? (s.lat != null ? "MANUAL" : null),
      sequence: s.sequence || i + 1,
      amount: isErrand ? 0 : (s.salesDocument?.totalAmount ?? 0),
      /**
       * Планувальник сайту борг у точку не кладе, тому беремо сальдо з
       * картки контрагента — те саме число з 1С, просто прочитане з іншого
       * місця. Без цього водій на маршруті сайту не побачив би кнопок
       * інкасації взагалі, а маршрут сайту тепер головне джерело.
       *
       * Це БОРГ КЛІЄНТА ЗАГАЛОМ, а не «за цю накладну»: 1С не розкладає
       * сальдо по документах доставки. Тому кнопка «забрав усе» ставить
       * саме цю суму, і водій за потреби виправляє її вручну.
       *
       * У бонусній поїздці грошей немає: там нічого не везуть.
       */
      debtAmount: isErrand ? 0 : Math.max(0, s.counterparty?.receivableBalance ?? 0),
      kind: s.kind,
      notes: s.notes,
      // Стан бонусної поїздки живе в самій точці: DELIVERED — зроблено,
      // FAILED — не вийшло. Для доставки лишаємо null: там правда у Visit.
      ownVisit:
        isErrand && s.status !== "PENDING"
          ? {
              status: s.status === "DELIVERED" ? "DONE" : "MISSED",
              money: "NOT_APPLICABLE",
              collectedAmount: null,
              comment: s.notes,
            }
          : null,
      routeSheetStopId: null,
      deliveryStopId: s.id,
    };
  });

  const geometry = route.routeGeometry as DayRoute["geometry"];
  return {
    source: "DELIVERY_ROUTE",
    id: `dr:${route.id}`,
    day: kyivDate(route.date),
    number: route.number,
    vehicle: route.vehicleInfo,
    plannedKm: route.totalDistanceKm,
    geometry: geometry && Array.isArray(geometry.coordinates) ? geometry : null,
    stops: mergeByAddress(stops),
  };
}

/** Точки водія на день: маршрут сайту, інакше (малоймовірно) лист із 1С. */
export async function resolveDriverDay(
  driverId: string,
  day: string,
  opts?: { includePlanned?: boolean }
): Promise<DayRoute> {
  const planned = await fromDeliveryRoute(driverId, day, opts?.includePlanned ?? false);
  if (planned) return planned;

  const sheet = await fromRouteSheet(driverId, day);
  if (sheet) return sheet;

  return EMPTY;
}

/**
 * Конкретний маршрутний лист водія — той, який він сам обрав у кабінеті.
 *
 * Окремо від resolveDriverDay, бо адреса тут інша: не «доба», а сам
 * документ. Різниця не косметична — на одну дату маршрутів буває два
 * (підміна, другий рейс), і день як адреса показав би лише один із них,
 * мовчки. Ключ приходить із префіксом джерела, бо `dr:` і `rs:` живуть у
 * різних таблицях і id між ними не унікальні.
 *
 * Чужий лист не відкриється: driverId у WHERE, а не перевіркою після
 * читання. Порожній результат означає і «немає такого», і «не ваш» —
 * навмисно, щоб з відповіді не можна було дізнатися про чужі маршрути.
 */
export async function resolveDriverRoute(driverId: string, key: string): Promise<DayRoute> {
  const id = key.slice(3);
  if (!id) return EMPTY;

  if (key.startsWith("dr:")) {
    const route = await prisma.deliveryRoute.findFirst({
      where: { id, driverId, status: { in: [...DRIVER_VISIBLE_STATUSES] } },
      include: ROUTE_INCLUDE,
    });
    return (route && mapDeliveryRoute(route)) ?? EMPTY;
  }

  if (key.startsWith("rs:")) {
    const sheet = await prisma.routeSheet.findFirst({
      where: { id, driverId },
      include: SHEET_INCLUDE,
    });
    return (sheet && mapRouteSheet(sheet)) ?? EMPTY;
  }

  return EMPTY;
}

/**
 * Приклеює відмітки до точок за клієнтом.
 *
 * Спільне для планшета і адмінки: обидва малюють точку кольором статусу,
 * і різні реалізації давали б різні кольори на тих самих даних.
 *
 * Бонусна поїздка приносить свою відмітку з собою (ownVisit) — шукати її
 * серед візитів немає сенсу, бо клієнта в неї немає.
 */
export function attachVisits<V extends StopVisit & { counterpartyId: string }>(
  stops: DayStop[],
  visits: V[]
): Array<DayStop & { visit: StopVisit | null }> {
  const byClient = new Map(visits.map((v) => [v.counterpartyId, v]));
  return stops.map((s) => ({
    ...s,
    visit:
      s.ownVisit ?? (s.counterpartyId ? (byClient.get(s.counterpartyId) ?? null) : null),
  }));
}
