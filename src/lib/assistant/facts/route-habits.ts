/**
 * Куди торговий їздить по днях тижня — за фактом, а не за планом.
 *
 * Питання «який у мене маршрут у четвер» має чотири різні відповіді, і
 * кожна окремо бреше. Шаблон маршруту каже, як задумано, але його
 * заводять не всі й не оновлюють. Замовлення кажуть, де вийшов результат,
 * але їх оформлюють і з офісу заднім числом. Відмітки візитів чесні, але
 * ставлять їх не щодня. Трек показує, де людина справді стояла, але не
 * знає, навіщо.
 *
 * Тому беремо всі чотири й складаємо. Вага різна: замовлення важить
 * найбільше (є результат), візит — менше, зупинка — ще менше (стояти
 * можна й на заправці).
 *
 * Про час. Дати документів з 1С зсунуті — агент віддає київський стінний
 * час, сервер читає його як UTC (див. track/orders-today.ts). Тому для
 * документів день тижня беремо простим EXTRACT, а для наших таблиць
 * (візити, трек) — київським kyivWeekday. Змішати їх означає зсунути
 * половину точок на день назад.
 */

import { prisma } from "@/lib/prisma";
import { kyivWeekday } from "@/lib/routes/resolve";
import { kyivDate } from "@/lib/date/kyiv";
import { findStops, type StopCandidate } from "@/lib/track/stops";
import { onlyWorkingHours } from "@/lib/track/work-hours";

/**
 * Родовий відмінок окремо від називного.
 *
 * «звичний для пʼятницяа» — рівно те, що виходить, коли до назви дня
 * дописати літеру. Текст підстави читає жива людина перед виїздом, і
 * машинна граматика підриває довіру до самої поради.
 */
export const WEEKDAY_GENITIVE = [
  "понеділка",
  "вівторка",
  "середи",
  "четверга",
  "пʼятниці",
  "суботи",
  "неділі",
];

/** Знахідний відмінок: «План на пʼятницю», а не «План на пʼятниця». */
export const WEEKDAY_ACCUSATIVE = [
  "понеділок",
  "вівторок",
  "середу",
  "четвер",
  "пʼятницю",
  "суботу",
  "неділю",
];

export const WEEKDAY_NAMES = [
  "понеділок",
  "вівторок",
  "середа",
  "четвер",
  "пʼятниця",
  "субота",
  "неділя",
];

export type HabitClient = {
  counterpartyId: string;
  name: string;
  orders: number;
  visits: number;
  stops: number;
  minutesAtPoint: number;
  lastAt: string | null;
  score: number;
};

export type WeekdayHabit = {
  weekday: number;
  clients: HabitClient[];
  template: { name: string; stops: string[] } | null;
};

export type RouteHabits = {
  weeks: number;
  byWeekday: WeekdayHabit[];
};

/** Скільки товару кожне джерело додає у вагу — див. шапку файлу. */
const W_ORDER = 3;
const W_VISIT = 2;
const W_STOP = 1;

/** Скільки клієнтів лишаємо на день: більше в голові однаково не тримають. */
const PER_DAY = 12;

type Cached = { at: number; value: RouteHabits };
const cache = new Map<string, Cached>();
const TTL_MS = 6 * 60 * 60 * 1000;

export async function routeHabits(repId: string, weeks = 8): Promise<RouteHabits> {
  const key = `${repId}:${weeks}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const sinceDay = kyivDate(new Date(Date.now() - weeks * 7 * 86_400_000));
  // Документи 1С лежать київським часом у полі UTC — межу беремо простою.
  const sinceDocs = new Date(`${sinceDay}T00:00:00.000Z`);

  const [orders, visits, assignments, sessions] = await Promise.all([
    ordersByWeekday(repId, sinceDocs),
    prisma.visit.findMany({
      where: { userId: repId, day: { gte: sinceDocs }, status: "DONE" },
      select: { day: true, counterpartyId: true, counterparty: { select: { name: true } } },
    }),
    prisma.routeAssignment.findMany({
      where: { repId, weekday: { not: null } },
      include: { template: { include: { stops: { orderBy: { seq: "asc" } } } } },
    }),
    prisma.trackSession.findMany({
      where: { userId: repId, day: { gte: sinceDocs } },
      select: { id: true, day: true },
    }),
  ]);

  const buckets = new Map<number, Map<string, HabitClient>>();
  for (let w = 1; w <= 7; w++) buckets.set(w, new Map());

  const bump = (
    weekday: number,
    counterpartyId: string,
    name: string,
    patch: Partial<HabitClient>,
    at: string | null
  ) => {
    const day = buckets.get(weekday);
    if (!day) return;
    const row =
      day.get(counterpartyId) ??
      ({
        counterpartyId,
        name,
        orders: 0,
        visits: 0,
        stops: 0,
        minutesAtPoint: 0,
        lastAt: null,
        score: 0,
      } as HabitClient);
    row.orders += patch.orders ?? 0;
    row.visits += patch.visits ?? 0;
    row.stops += patch.stops ?? 0;
    row.minutesAtPoint += patch.minutesAtPoint ?? 0;
    if (at && (!row.lastAt || at > row.lastAt)) row.lastAt = at;
    day.set(counterpartyId, row);
  };

  for (const o of orders) {
    bump(o.weekday, o.counterpartyId, o.name, { orders: o.orders }, kyivDate(o.lastAt));
  }
  for (const v of visits) {
    const dayStr = kyivDate(v.day);
    bump(
      kyivWeekday(dayStr),
      v.counterpartyId,
      v.counterparty?.name ?? "—",
      { visits: 1 },
      dayStr
    );
  }

  // Зупинки: підписуємо їх клієнтом, чия точка ближче 150 м (findStops).
  if (sessions.length > 0) {
    const candidates = await stopCandidates();
    const points = await prisma.trackPoint.findMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
      orderBy: { recordedAt: "asc" },
      select: { sessionId: true, lat: true, lng: true, recordedAt: true },
    });

    const bySession = new Map<string, typeof points>();
    for (const p of points) {
      const list = bySession.get(p.sessionId) ?? [];
      list.push(p);
      bySession.set(p.sessionId, list);
    }

    const nameById = new Map(candidates.map((c) => [c.counterpartyId, c.name]));
    for (const session of sessions) {
      const list = bySession.get(session.id);
      if (!list || list.length < 3) continue;
      const dayStr = kyivDate(session.day);
      const weekday = kyivWeekday(dayStr);
      for (const stop of findStops(onlyWorkingHours(list), candidates)) {
        if (!stop.counterpartyId) continue;
        bump(
          weekday,
          stop.counterpartyId,
          nameById.get(stop.counterpartyId) ?? "—",
          { stops: 1, minutesAtPoint: Math.round(stop.minutes) },
          dayStr
        );
      }
    }
  }

  const templateByWeekday = new Map<number, { name: string; stops: string[] }>();
  for (const a of assignments) {
    if (a.weekday == null) continue;
    templateByWeekday.set(a.weekday, {
      name: a.template.name,
      stops: a.template.stops.map((s) => s.displayName ?? s.settlement),
    });
  }

  const byWeekday: WeekdayHabit[] = [];
  for (let w = 1; w <= 7; w++) {
    const rows = [...(buckets.get(w)?.values() ?? [])].map((r) => ({
      ...r,
      score: r.orders * W_ORDER + r.visits * W_VISIT + r.stops * W_STOP,
    }));
    rows.sort((a, b) => b.score - a.score);
    byWeekday.push({
      weekday: w,
      clients: rows.slice(0, PER_DAY),
      template: templateByWeekday.get(w) ?? null,
    });
  }

  const value: RouteHabits = { weeks, byWeekday };
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Усі клієнти з координатами — кандидати на підпис зупинки. */
async function stopCandidates(): Promise<StopCandidate[]> {
  const rows = await prisma.counterparty.findMany({
    where: { deliveryLat: { not: null }, deliveryLng: { not: null } },
    select: { id: true, name: true, deliveryLat: true, deliveryLng: true },
  });
  return rows.map((r) => ({
    counterpartyId: r.id,
    name: r.name,
    lat: r.deliveryLat,
    lng: r.deliveryLng,
  }));
}

type OrderRow = {
  weekday: number;
  counterpartyId: string;
  name: string;
  orders: number;
  lastAt: Date;
};

/**
 * Замовлення по днях тижня з драбиною торгового.
 *
 * Драбина та сама, що в orders-today.ts: «Ответственный» документа →
 * закріплення клієнта → останній документ клієнта. Без неї половина
 * замовлень лишилася б без торгового, бо офіс проводить їх на себе.
 */
async function ordersByWeekday(repId: string, since: Date): Promise<OrderRow[]> {
  return prisma.$queryRaw<OrderRow[]>`
    SELECT
      EXTRACT(ISODOW FROM s."createdAt")::int AS weekday,
      c.id AS "counterpartyId",
      c.name AS name,
      COUNT(*)::int AS orders,
      MAX(s."createdAt") AS "lastAt"
    FROM "SalesDocument" s
    JOIN "Counterparty" c ON c.id = s."counterpartyId"
    LEFT JOIN LATERAL (
      SELECT "salesRepId" FROM "SalesRepClient"
      WHERE "counterpartyId" = c.id ORDER BY id LIMIT 1
    ) rc ON TRUE
    LEFT JOIN LATERAL (
      SELECT "salesRepId" FROM "SalesDocument"
      WHERE "counterpartyId" = c.id AND "salesRepId" IS NOT NULL AND "docType" <> 'RETURN'
      ORDER BY ("docType" = 'REALIZATION') DESC, "createdAt" DESC
      LIMIT 1
    ) last ON TRUE
    WHERE s."docType" = 'ORDER'
      AND s."externalId" IS NOT NULL
      AND s.status <> 'CANCELLED'
      AND s."createdAt" >= ${since}
      AND COALESCE(s."salesRepId", rc."salesRepId", last."salesRepId") = ${repId}
    GROUP BY 1, 2, 3
  `;
}
