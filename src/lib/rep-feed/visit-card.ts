/**
 * Картка перед візитом: машина зупинилась біля клієнта — що про нього знати.
 *
 * Те саме, що торговий міг би спитати в помічника («з чим зайти до Химича»),
 * але він не питає: у полі не до того. Тут воно приходить само, у ту мить,
 * коли стало потрібним, — і лише тоді.
 *
 * Джерело — трек, а не «я зараз тут» з браузера. Тому картка працює
 * ТІЛЬКИ при живому треку, і це свідомо: єдина користь застосунку, яка
 * залежить від того, чи пишеться маршрут, — це і є стимул його не вбивати.
 *
 * Три речі, від яких залежить, чи не стане це спамом:
 *
 * 1. Зупинка, а не проїзд. `findStops` бере лише стоянку від 5 хвилин
 *    (класифікатор руху той самий, що на карті дня), і клієнт має бути
 *    ближче 150 м від центру хмари точок.
 * 2. Лише точні піни. Клієнт, геокодований до міста (`geoSource = CITY`),
 *    стоїть у центрі міста разом із сотнею інших — і кожна зупинка на
 *    площі підписувалась би ним. Такі не кандидати.
 * 3. Одна картка на клієнта на день, і лише коли є що сказати: борг або
 *    поради. Без них пуш «Ви у Химича» — шум.
 */

import { prisma } from "@/lib/prisma";
import { agingByCounterparty } from "@/lib/analytics/money-facts";
import { lastOrders, ordersSince, recommendations } from "@/lib/analytics/clientOrder";
import { myClientsCte } from "@/lib/assistant/facts/sql";
import { kyivDate } from "@/lib/date/kyiv";
import { findStops, type StopCandidate } from "@/lib/track/stops";
import { describeVisit } from "./format";
import { isInternalCounterparty, loadStaffNames } from "./internal";
import { REP_FEED_TYPES, type FeedEvent } from "./types";

/** Скільки хвилин треку читаємо назад: має вмістити стоянку від 5 хв. */
const LOOKBACK_MINUTES = 45;

/**
 * Зупинка мусить тривати досі або щойно скінчитися. Старіша — це або
 * мертвий трек (і тоді картка не потрібна: людини там уже може не бути),
 * або стоянка, про яку ми вже казали.
 */
const RECENT_END_MINUTES = 12;

const MIN_POINTS = 3;

type CandidateRow = { id: string; name: string; lat: number; lng: number };

/**
 * Клієнти торгового з точним піном — кандидати на підпис зупинки.
 * Без внутрішніх: склад із піном MANUAL інакше ставав би «клієнтом» щоранку.
 */
async function candidatesFor(repId: string, staff: ReadonlySet<string>): Promise<StopCandidate[]> {
  const rows = await prisma.$queryRaw<CandidateRow[]>`
    WITH ${myClientsCte(repId)}
    SELECT c.id, c.name, c."deliveryLat"::float AS lat, c."deliveryLng"::float AS lng
    FROM "Counterparty" c
    WHERE c.id IN (SELECT id FROM my_clients)
      AND c."deliveryLat" IS NOT NULL AND c."deliveryLng" IS NOT NULL
      AND (c."geoSource" IS NULL OR c."geoSource"::text IN ('GEOCODED', 'MANUAL'))
  `;
  return rows
    .filter((r) => !isInternalCounterparty(r.name, staff))
    .map((r) => ({ counterpartyId: r.id, name: r.name, lat: r.lat, lng: r.lng }));
}

export function visitDedupKey(day: string, repId: string, counterpartyId: string): string {
  return `${REP_FEED_TYPES.VISIT}:${day}:${repId}:${counterpartyId}`;
}

/**
 * Зібрати текст картки. Дорого (до 1,3 с на клієнта через рекомендації),
 * тому кличемо лише для зупинки, про яку ще не казали.
 */
export async function buildVisitCard(
  counterpartyId: string
): Promise<{ title: string; body: string } | null> {
  const [cp, aging, orders, recos] = await Promise.all([
    prisma.counterparty.findUnique({ where: { id: counterpartyId }, select: { name: true } }),
    agingByCounterparty([counterpartyId]),
    lastOrders(counterpartyId, { since: ordersSince(0), limit: 1 }),
    recommendations(counterpartyId),
  ]);
  const a = aging.get(counterpartyId);
  return describeVisit({
    name: cp?.name,
    debt: a?.debt ?? 0,
    overdue: a?.overdue ?? 0,
    oldestDays: a?.oldestDays ?? 0,
    lastOrderDaysAgo: orders[0]?.daysAgo ?? null,
    recommend: recos.map((r) => r.name),
  });
}

/** Картки для всіх торгових із відкритою зміною — по одній на стоянку. */
export async function collectVisitCards(now: Date): Promise<FeedEvent[]> {
  const open = await prisma.shift.findMany({
    where: { status: "OPEN", user: { role: "SALES" } },
    select: { userId: true },
    distinct: ["userId"],
  });
  if (open.length === 0) return [];

  const day = kyivDate(now);
  const staff = await loadStaffNames();
  const since = new Date(now.getTime() - LOOKBACK_MINUTES * 60_000);
  const recentEdge = now.getTime() - RECENT_END_MINUTES * 60_000;
  const events: FeedEvent[] = [];

  for (const { userId: repId } of open) {
    const points = await prisma.trackPoint.findMany({
      where: { userId: repId, recordedAt: { gte: since } },
      orderBy: { recordedAt: "asc" },
      select: { lat: true, lng: true, recordedAt: true, speedKmh: true },
    });
    if (points.length < MIN_POINTS) continue;

    const stops = findStops(points, await candidatesFor(repId, staff)).filter(
      (s) => s.counterpartyId && s.to.getTime() >= recentEdge
    );
    // Остання за часом: якщо людина встигла постояти у двох, друга актуальніша.
    const stop = stops[stops.length - 1];
    if (!stop?.counterpartyId) continue;

    const dedupKey = visitDedupKey(day, repId, stop.counterpartyId);
    // Перевірка ДО дорогої картки: стоянка триває пів години, а тік іде
    // кожні п'ять хвилин — інакше рахували б рекомендації шість разів.
    const known = await prisma.notification.findUnique({ where: { dedupKey }, select: { id: true } });
    if (known) continue;

    const card = await buildVisitCard(stop.counterpartyId);
    if (!card) continue;

    events.push({
      type: REP_FEED_TYPES.VISIT,
      repId,
      dedupKey,
      relatedId: stop.counterpartyId,
      target: `/sales/clients/${stop.counterpartyId}`,
      ...card,
      at: now,
      standalone: true,
    });
  }
  return events;
}
