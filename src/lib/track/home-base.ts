/**
 * Де торговий насправді починає день.
 *
 * Адресу бази вводить адмін руками, і на цьому все ламається двічі: половину
 * наших адрес геокодер не знає («Львів, вул. Незимна» в OSM просто немає), а
 * введена адреса з часом стає неправдою — людина переїхала, а в довіднику
 * лишилось старе. GPS про це знає без чужої допомоги: планшет щоранку
 * повідомляє, звідки виїхали.
 *
 * Тому базу ВИЗНАЧАЄМО з треку, а не питаємо. Ідея проста: беремо першу точку
 * кожного робочого дня за останні тижні й дивимось, чи вони збиваються в одну
 * купку. Якщо більшість ранків починалися в межах кола радіусом ~700 м —
 * це і є база.
 *
 * Чому 700 м, а не 100. Точність GPS у дворі під дахом чи між будинками
 * гуляє на сотні метрів, а перша точка дня ловиться вже в дорозі — планшет
 * прокидається не в момент виходу з хати. Вимагати 100 м означало б не
 * знайти базу ніколи. Заразом 700 м — це та точність, яка для подачі не має
 * значення: плече міряється десятками кілометрів.
 */

import { prisma } from "@/lib/prisma";
import { haversineM } from "@/lib/track/geo";
import { kyivDate } from "@/lib/date/kyiv";
import { isWorkingTime } from "@/lib/track/work-hours";

/** Радіус купки, у межах якого ранки вважаємо «тим самим місцем». */
export const BASE_RADIUS_M = 700;

/** Скільком ранкам треба збігтися, щоб це була база, а не випадковість. */
export const MIN_MORNINGS = 3;

/** Скільки днів історії дивимось. Місяць: переїзд не тягнеться вічно. */
export const LOOKBACK_DAYS = 30;

/**
 * Частка ранків у купці, за якої базі можна вірити.
 *
 * Нижче цього торговий стартує з різних місць (живе на два дома, ночує в
 * роз'їздах) — і «база» була б середнім по палаті, гіршим за відсутність.
 */
export const MIN_SHARE = 0.6;

export type LearnedBase = {
  lat: number;
  lng: number;
  /** Скільки ранків потрапило в купку. */
  mornings: number;
  /** Скільки робочих днів розглянули взагалі. */
  daysSeen: number;
  /** mornings / daysSeen — наскільки стабільно людина стартує звідси. */
  share: number;
  /** Найдальший ранок у купці, метри: наскільки насправді розкидано. */
  spreadM: number;
  firstDay: string;
  lastDay: string;
};

/** Перша робоча точка кожного дня за київським календарем. */
type Morning = { day: string; lat: number; lng: number };

/**
 * Ранки одразу для кількох людей — один запит на всіх.
 *
 * Окремий виклик на кожного торгового означав би десяток сканів по місяцю
 * точок на КОЖЕН перегляд таблиці; тут одна вибірка й розкладка в пам'яті.
 */
async function morningsForMany(
  userIds: string[],
  since: Date
): Promise<Map<string, Morning[]>> {
  const byUser = new Map<string, Morning[]>();
  if (userIds.length === 0) return byUser;

  const points = await prisma.trackPoint.findMany({
    where: { userId: { in: userIds }, recordedAt: { gte: since } },
    select: { userId: true, recordedAt: true, lat: true, lng: true },
    orderBy: { recordedAt: "asc" },
  });

  // Ключ «користувач+день»: перша точка дня перемагає, решта дня не цікавить.
  const seen = new Set<string>();
  for (const p of points) {
    // Ніч у дворі — це дрейф GPS, а не початок дня: планшет лежить удома і
    // малює «поїздки», яких не було. Беремо лише робоче вікно.
    if (!isWorkingTime(p.recordedAt)) continue;
    const day = kyivDate(p.recordedAt);
    const key = `${p.userId}|${day}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const list = byUser.get(p.userId) ?? [];
    list.push({ day, lat: p.lat, lng: p.lng });
    byUser.set(p.userId, list);
  }

  return byUser;
}

/**
 * Найбільша купка ранків у радіусі BASE_RADIUS_M.
 *
 * Перебір усіх центрів-кандидатів, а не k-means: ранків — десятки, тому
 * O(n²) тут дешевший за будь-яку розумнішу схему, і головне — результат
 * детермінований. k-means з випадковою ініціалізацією давав би різну базу
 * на тих самих даних, а це поле, яке людина бачить і якому має вірити.
 */
function biggestCluster(mornings: Morning[]): Morning[] {
  let best: Morning[] = [];

  for (const centre of mornings) {
    const near = mornings.filter(
      (m) => haversineM(centre.lat, centre.lng, m.lat, m.lng) <= BASE_RADIUS_M
    );
    if (near.length > best.length) best = near;
  }

  return best;
}

/**
 * Вивчена база або null, якщо даних мало чи старти надто розкидані.
 *
 * null тут — теж відповідь: краще лишити поле порожнім, ніж підставити
 * центр між двома різними домами, який не є жодним із них.
 */
function baseFromMornings(mornings: Morning[]): LearnedBase | null {
  if (mornings.length < MIN_MORNINGS) return null;

  const cluster = biggestCluster(mornings);
  if (cluster.length < MIN_MORNINGS) return null;

  const share = cluster.length / mornings.length;
  if (share < MIN_SHARE) return null;

  // Центр — середнє по купці. На такому радіусі проєкція не потрібна:
  // 700 м широти й довготи в Україні розходяться на одиниці метрів.
  const lat = cluster.reduce((s, m) => s + m.lat, 0) / cluster.length;
  const lng = cluster.reduce((s, m) => s + m.lng, 0) / cluster.length;

  const spreadM = Math.round(
    Math.max(...cluster.map((m) => haversineM(lat, lng, m.lat, m.lng)))
  );

  return {
    lat,
    lng,
    mornings: cluster.length,
    daysSeen: mornings.length,
    share,
    spreadM,
    firstDay: cluster[0].day,
    lastDay: cluster[cluster.length - 1].day,
  };
}

/** Вивчені бази для списку людей — один запит на всіх. */
export async function learnHomeBases(
  userIds: string[],
  opts?: { lookbackDays?: number }
): Promise<Map<string, LearnedBase>> {
  const days = opts?.lookbackDays ?? LOOKBACK_DAYS;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const byUser = await morningsForMany(userIds, since);
  const out = new Map<string, LearnedBase>();
  for (const [userId, mornings] of byUser) {
    const base = baseFromMornings(mornings);
    if (base) out.set(userId, base);
  }
  return out;
}

/** Вивчена база однієї людини. */
export async function learnHomeBase(
  userId: string,
  opts?: { lookbackDays?: number }
): Promise<LearnedBase | null> {
  const all = await learnHomeBases([userId], opts);
  return all.get(userId) ?? null;
}

/**
 * Чи розходиться вивчена база з тією, що в довіднику.
 *
 * Потрібно, щоб не пропонувати «оновити» те саме місце і щоб помітити
 * переїзд: адреса лишилась стара, а виїжджає людина вже з іншого району.
 */
export function baseMovedM(
  learned: { lat: number; lng: number },
  saved: { baseLat: number | null; baseLng: number | null }
): number | null {
  if (saved.baseLat == null || saved.baseLng == null) return null;
  return Math.round(haversineM(learned.lat, learned.lng, saved.baseLat, saved.baseLng));
}
