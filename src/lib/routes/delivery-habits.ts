/**
 * Звички доставки: чого навчила історія маршрутних листів.
 *
 * Пʼять лічильників, а не модель. Вони прозорі настільки, що кожне рішення
 * планувальника можна пояснити людині одним рядком — «Коваль: 9 з 11 доставок
 * возив Пайда», — і саме це робить автоматичний план прийнятним для того,
 * хто досі складав його головою.
 *
 * Джерело — листи з 1С, а не маршрути сайту: листів 139 проти 9, і вся
 * фактична розвозка живе саме в них.
 *
 * Водій береться з `driverId`, а коли обмін його не прив'язав (17 листів зі
 * 139) — через `driverExternalId1C`, бо Ref_Key стабільніший за ім'я.
 *
 * Усе рахується одним запитом і згортається в пам'яті: 2157 точок — обсяг,
 * на якому окрема таблиця профілів коштувала б більше, ніж економила.
 *
 * `pairKey` і тип `DriverHabit` беремо з ядра plan-day: ядро має лишатися
 * придатним до запуску без бази, тому спільне живе там, а не тут.
 */

import { prisma } from "@/lib/prisma";
import { pairKey, type DriverHabit } from "@/lib/routes/plan-day";

export type DriverCapacity = {
  /**
   * Звична денна норма кілометрів, медіана по листах цього водія.
   *
   * Спочатку цього поля не було, бо памʼять проєкту казала, що кілометраж у
   * листах 1С не ведуть. Станом на 23.09.2026 він заповнений у 128 зі 139
   * листів, і норми водіїв різняться вдвічі: у Пайди медіана 277 км, у
   * Піцишина — 206. Без цього числа план не мав чим відрізнити довгий, але
   * робочий день від фізично неможливого.
   */
  medianKm: number | null;
  /** Верхня межа звичного: 80-й процентиль денних кілометрів */
  p80Km: number | null;
  /** Скільки точок брати за межу дня: 80-й процентиль по історії */
  maxStops: number;
  medianStops: number;
  /** Скільки днів історії стоїть за цими числами */
  days: number;
};

export type DeliveryHabits = {
  /** counterpartyId → водії за спаданням кількості доставок */
  driverByClient: Map<string, DriverHabit[]>;
  /** counterpartyId → скільки разів клієнт був у листі кожного дня тижня, індекс 0 = понеділок */
  weekdayByClient: Map<string, number[]>;
  /** `pairKey(a, b)` → скільки разів двоє клієнтів були в одному листі */
  pairs: Map<string, number>;
  /** driverId → межа дня */
  capacity: Map<string, DriverCapacity>;
  /** counterpartyId → скільки доставок мав. Відсутній ключ = не возили ЖОДНОГО разу */
  deliveriesByClient: Map<string, number>;
};

/** Скільки історії беремо за замовчуванням. */
export const DEFAULT_SINCE_DAYS = 180;

/** Який процентиль денних точок вважати межею дня. */
const CAPACITY_PERCENTILE = 0.8;

/** Межа дня для водія, якого в історії ще немає (медіана по фірмі). */
export const DEFAULT_MAX_STOPS = 16;

type HistoryRow = {
  sheet_id: string;
  distance_km: number | null;
  driver_id: string | null;
  sheet_date: Date;
  cp: string;
};

/** Процентиль по відсортованому масиву; порожній — null. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.max(0, Math.ceil(p * sorted.length) - 1);
  return sorted[idx];
}

export async function deliveryHabits(sinceDays = DEFAULT_SINCE_DAYS): Promise<DeliveryHabits> {
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const rows = await prisma.$queryRaw<HistoryRow[]>`
    SELECT rs.id AS sheet_id,
           rs."distanceKm" AS distance_km,
           COALESCE(rs."driverId", u.id) AS driver_id,
           rs.date AS sheet_date,
           s."counterpartyId" AS cp
    FROM "RouteSheet" rs
    JOIN "RouteSheetStop" s
      ON s."routeSheetId" = rs.id AND s.hidden = false
    LEFT JOIN "User" u
      ON u."driver1CExternalId" = rs."driverExternalId1C"
    WHERE rs.date >= ${since}
      AND s."counterpartyId" IS NOT NULL
  `;

  /* Лист → його водій, день і склад клієнтів. Клієнти в множині: три рядки
     на одну адресу — це одна точка, і для пар та місткості вони не троїться. */
  const sheets = new Map<
    string,
    { driverId: string | null; weekday: number; clients: Set<string>; distanceKm: number | null }
  >();

  for (const row of rows) {
    let sheet = sheets.get(row.sheet_id);
    if (!sheet) {
      // getUTCDay(): 0 = неділя. Нам треба 0 = понеділок.
      const weekday = (row.sheet_date.getUTCDay() + 6) % 7;
      sheet = { driverId: row.driver_id, weekday, clients: new Set(), distanceKm: row.distance_km };
      sheets.set(row.sheet_id, sheet);
    }
    sheet.clients.add(row.cp);
  }

  const driverCounts = new Map<string, Map<string, number>>();
  const weekdayByClient = new Map<string, number[]>();
  const pairs = new Map<string, number>();
  const deliveriesByClient = new Map<string, number>();
  const stopsPerDay = new Map<string, number[]>();
  const kmPerDay = new Map<string, number[]>();

  for (const sheet of sheets.values()) {
    const clients = [...sheet.clients];

    for (const cp of clients) {
      deliveriesByClient.set(cp, (deliveriesByClient.get(cp) ?? 0) + 1);

      const week = weekdayByClient.get(cp) ?? [0, 0, 0, 0, 0, 0, 0];
      week[sheet.weekday]++;
      weekdayByClient.set(cp, week);

      if (sheet.driverId) {
        const byDriver = driverCounts.get(cp) ?? new Map<string, number>();
        byDriver.set(sheet.driverId, (byDriver.get(sheet.driverId) ?? 0) + 1);
        driverCounts.set(cp, byDriver);
      }
    }

    for (let i = 0; i < clients.length; i++) {
      for (let j = i + 1; j < clients.length; j++) {
        const key = pairKey(clients[i], clients[j]);
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }

    if (sheet.driverId) {
      const list = stopsPerDay.get(sheet.driverId) ?? [];
      list.push(clients.length);
      stopsPerDay.set(sheet.driverId, list);

      // Нульовий кілометраж — це «не заповнили», а не «нікуди не їхав».
      if (sheet.distanceKm !== null && sheet.distanceKm > 0) {
        const km = kmPerDay.get(sheet.driverId) ?? [];
        km.push(sheet.distanceKm);
        kmPerDay.set(sheet.driverId, km);
      }
    }
  }

  const driverByClient = new Map<string, DriverHabit[]>();
  for (const [cp, byDriver] of driverCounts) {
    const list = [...byDriver.entries()]
      .map(([driverId, count]) => ({ driverId, count }))
      .sort((a, b) => b.count - a.count);
    driverByClient.set(cp, list);
  }

  const capacity = new Map<string, DriverCapacity>();
  for (const [driverId, list] of stopsPerDay) {
    const sorted = [...list].sort((a, b) => a - b);
    const km = [...(kmPerDay.get(driverId) ?? [])].sort((a, b) => a - b);
    capacity.set(driverId, {
      maxStops: percentile(sorted, CAPACITY_PERCENTILE) ?? DEFAULT_MAX_STOPS,
      medianStops: percentile(sorted, 0.5) ?? DEFAULT_MAX_STOPS,
      medianKm: percentile(km, 0.5),
      p80Km: percentile(km, CAPACITY_PERCENTILE),
      days: list.length,
    });
  }

  return { driverByClient, weekdayByClient, pairs, capacity, deliveriesByClient };
}
