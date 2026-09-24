/**
 * Де стоїть магазин клієнта — за тим, де стояв торговий, коли набивав його замовлення.
 *
 * Навіщо. Сотні клієнтів стоять у центрі міста (geoSource CITY): адреса в
 * картці чітка — «м.Бібрка, Крушельницької 3», — а OpenStreetMap такої
 * вулиці в малому місті не знає. Торговий же набиває замовлення в Impuls,
 * стоячи в магазині, і його трек знає, де він тоді стояв.
 *
 * Час документа з 1С — київський, але збережений як UTC (див. kyivMoment):
 * без поправки замовлення «відставало» від стоянки на рівні 3 години плюс
 * хвилини. З поправкою його набивають через 0–80 хв після початку стоянки,
 * найчастіше — через ~36 хв (виміряно 23.09.2026 на 211 замовленнях біля
 * ручних точок).
 *
 * Одне замовлення стоянку не визначає: за 80 хв торговий встигає побувати ще
 * у 2–3 магазинах, і вгадування «по документу» влучало в половині випадків.
 * Тому кожне замовлення ГОЛОСУЄ за стоянки свого дня з вагою за зсувом у
 * часі. Правильне місце щоразу те саме й набирає голоси, хибні — щоразу
 * інші сусіди. Самоперевірка на 67 клієнтах із ручною точкою: коли лідер
 * має ≥60% голосів — 30 із 31 у межах 120 м; із умовою ≥3 замовлень
 * промахів не лишилося (scripts/pins-from-track.mts).
 *
 * Лише читання. Точку ставить або людина (попап карти), або скрипт — лише
 * для впевнених.
 */

import { prisma } from "@/lib/prisma";
import { repPlaces, type RepPlace } from "@/lib/track/rep-places";
import { findStops, type TrackStop } from "@/lib/track/stops";

/** Скільки днів назад дивимось. */
const PERIOD_DAYS = 90;
/** Радіус «того самого міста» довкола нинішньої приблизної точки. */
const TOWN_RADIUS_KM = 8;
/** Стоянки ближче за це — одне місце. */
const CLUSTER_M = 70;
/** Скільки кандидатів показувати. */
const MAX_CANDIDATES = 4;
/** Трек, у якому менше точок, — уривок, а не робочий день. */
const MIN_DAY_POINTS = 40;
/** Стоянка ближче за це до дому чи складу торгового не голосує. */
const HOME_M = 300;

/** Зсув «замовлення − початок стоянки», хв: пік і ширина (виміряно). */
const LAG_PEAK = 36;
const LAG_WIDTH = 30;

/** Коли місцю можна вірити без людини. */
export const AUTO_MIN_SHARE = 0.6;
export const AUTO_MIN_DOCS = 3;

export type PinCandidate = {
  /** Мітка на карті й у списку: A, B, C… */
  label: string;
  lat: number;
  lng: number;
  /** Частка голосів замовлень клієнта за це місце, 0–1. */
  share: number;
  /** Скільки різних днів сюди йшли голоси. */
  days: number;
  minutesMin: number;
  minutesMax: number;
  repName: string;
  lastDay: string;
  /** Від нинішньої точки клієнта, м. */
  distanceM: number;
};

export type PinCandidatesResult = {
  name: string;
  current: { lat: number; lng: number } | null;
  /** Скільки замовлень проголосували (мали стоянки в потрібний час). */
  votedDocs: number;
  candidates: PinCandidate[];
  /** Лідер настільки однозначний, що його можна ставити без людини. */
  confident: boolean;
  note: string | null;
};

type Pt = { lat: number; lng: number };
const meters = (a: Pt, b: Pt) =>
  111_320 * Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180));
const kyivDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });

/**
 * Справжній момент документа 1С.
 *
 * Обмін кладе «12:24» з 1С як 12:24 UTC, хоча в 1С це київські 12:24 —
 * тобто 09:24 UTC улітку. Віднімаємо київський зсув саме цієї дати: взимку
 * він 2 години, влітку 3.
 */
export function kyivMoment(stored: Date): Date {
  const kyiv = new Date(stored.toLocaleString("en-US", { timeZone: "Europe/Kyiv" }));
  const utc = new Date(stored.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(stored.getTime() - (kyiv.getTime() - utc.getTime()));
}

/** Вага стоянки для замовлення за зсувом, хв: дзвін довкола піку, поза вікном — нуль. */
function lagWeight(lagMin: number): number {
  if (lagMin < -10 || lagMin > 150) return 0;
  return Math.exp(-((lagMin - LAG_PEAK) ** 2) / (2 * LAG_WIDTH * LAG_WIDTH));
}

/** Стоянки торгового за день — спільний кеш на один виклик (і на пакет у скрипті). */
export type StopsCache = Map<string, TrackStop[]>;
/** Дім і склад кожного торгового — теж спільний кеш на пакет. */
export type PlacesCache = Map<string, RepPlace[]>;

async function placesFor(reps: string[], cache: PlacesCache): Promise<PlacesCache> {
  const missing = reps.filter((r) => !cache.has(r));
  if (missing.length) for (const [k, v] of await repPlaces(missing)) cache.set(k, v);
  return cache;
}

async function dayStops(rep: string, day: string, cache: StopsCache): Promise<TrackStop[]> {
  const key = `${rep}|${day}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const from = new Date(`${day}T00:00:00+03:00`);
  const pts = await prisma.trackPoint.findMany({
    where: { userId: rep, recordedAt: { gte: new Date(from.getTime() - 3_600_000), lt: new Date(from.getTime() + 25 * 3_600_000) } },
    orderBy: { recordedAt: "asc" },
    select: { lat: true, lng: true, recordedAt: true, speedKmh: true },
  });
  const stops = pts.length >= MIN_DAY_POINTS ? findStops(pts) : [];
  cache.set(key, stops);
  return stops;
}

/**
 * @param around центр пошуку. За замовчуванням — нинішня точка клієнта;
 *   самоперевірка передає справжню ручну точку.
 */
export async function pinCandidates(
  counterpartyId: string,
  opts: { around?: Pt; cache?: StopsCache; places?: PlacesCache } = {}
): Promise<PinCandidatesResult | null> {
  const cache = opts.cache ?? new Map();
  const placesCache = opts.places ?? new Map();
  const client = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: { name: true, deliveryLat: true, deliveryLng: true },
  });
  if (!client) return null;
  const current = client.deliveryLat != null && client.deliveryLng != null ? { lat: client.deliveryLat, lng: client.deliveryLng } : null;
  const center = opts.around ?? current;
  const empty = (note: string): PinCandidatesResult => ({ name: client.name, current, votedDocs: 0, candidates: [], confident: false, note });
  if (!center) return empty("У клієнта немає навіть приблизної точки — нема від чого шукати місто.");

  const since = new Date(Date.now() - PERIOD_DAYS * 86_400_000);
  // Замовлення — те, що торговий набиває в магазині. Реалізація з тим самим
  // часом дала б кожному візиту другий голос; беремо її лише без замовлень.
  let docs = await prisma.salesDocument.findMany({
    where: { counterpartyId, docType: "ORDER", createdAt: { gte: since }, salesRepId: { not: null } },
    select: { salesRepId: true, createdAt: true },
  });
  if (docs.length === 0) {
    docs = await prisma.salesDocument.findMany({
      where: { counterpartyId, docType: "REALIZATION", createdAt: { gte: since }, salesRepId: { not: null } },
      select: { salesRepId: true, createdAt: true },
    });
  }

  /*
   * Відкриття картки клієнта в застосунку (подія `human` вебаналітики, з
   * 16.09.2026) — теж свідок: торговий дивився клієнта, стоячи десь. Час тут
   * справжній UTC, а не київський-як-UTC з 1С, тож голосує стоянка, яка
   * накриває сам момент, без дзвона затримки.
   */
  const opens = await prisma.siteEvent.findMany({
    where: {
      type: "human",
      userId: { not: null },
      createdAt: { gte: since },
      path: { in: [`/sales/clients/${counterpartyId}`, `/sales/clients/${counterpartyId}/pin`] },
    },
    select: { userId: true, createdAt: true },
  });
  if (docs.length === 0 && opens.length === 0) {
    return empty(`За ${PERIOD_DAYS} днів у клієнта немає документів торгового — нема з чим звіряти трек.`);
  }

  const places = await placesFor(
    [...new Set([...docs.map((d) => d.salesRepId!), ...opens.map((o) => o.userId!)])],
    placesCache
  );
  /** Лише стоянки в цьому місті і не вдома / не на складі. */
  const usable = async (rep: string, day: string) =>
    (await dayStops(rep, day, cache)).filter(
      (s) =>
        meters(s, center) <= TOWN_RADIUS_KM * 1000 &&
        !(places.get(rep) ?? []).some((p) => meters(p, s) <= HOME_M)
    );

  type Vote = Pt & { v: number; day: string; minutes: number; rep: string };
  const votes: Vote[] = [];
  let voted = 0;
  const cast = (rep: string, day: string, stops: TrackStop[], w: number[]) => {
    const sum = w.reduce((a, b) => a + b, 0);
    if (sum <= 0) return;
    voted++;
    stops.forEach((s, i) => {
      if (w[i] > 0) votes.push({ lat: s.lat, lng: s.lng, v: w[i] / sum, day, minutes: s.minutes, rep });
    });
  };

  for (const d of docs) {
    const t = kyivMoment(d.createdAt);
    const day = kyivDay(t);
    /*
     * Лише стоянки в цьому місті. Нормування по всіх стоянках дня здавалося
     * чеснішим («набили вже в сусідньому місті — хай голос іде туди»), але
     * на ручних точках дало 7 упевнених відповідей замість 31: замовлення,
     * які торговий добиває в дорозі чи ввечері, розмивали частку правильного
     * місця. Що клієнт у цьому місті — ми й так знаємо з адреси.
     */
    const stops = await usable(d.salesRepId!, day);
    cast(d.salesRepId!, day, stops, stops.map((s) => lagWeight((t.getTime() - s.from.getTime()) / 60_000)));
  }

  for (const o of opens) {
    const t = o.createdAt.getTime();
    const day = kyivDay(o.createdAt);
    const stops = await usable(o.userId!, day);
    cast(o.userId!, day, stops, stops.map((s) => (t >= s.from.getTime() - 300_000 && t <= s.to.getTime() + 300_000 ? 1 : 0)));
  }

  if (voted === 0) return empty("У дні замовлень трек торгового не показує стоянок поблизу часу замовлення — або трек тоді ще не писався.");
  if (votes.length === 0) return empty("Замовлення цього клієнта набивали, коли торговий стояв деінде поза цим містом.");

  const clusters: Array<{ c: Pt; members: Vote[]; v: number }> = [];
  for (const x of [...votes].sort((a, b) => b.v - a.v)) {
    const k = clusters.find((k) => meters(k.c, x) <= CLUSTER_M);
    if (k) {
      k.members.push(x);
      k.v += x.v;
      const n = k.members.length;
      k.c = { lat: k.members.reduce((a, m) => a + m.lat, 0) / n, lng: k.members.reduce((a, m) => a + m.lng, 0) / n };
    } else clusters.push({ c: { lat: x.lat, lng: x.lng }, members: [x], v: x.v });
  }
  clusters.sort((a, b) => b.v - a.v);

  const repIds = [...new Set(votes.map((v) => v.rep))];
  const names = new Map(
    (await prisma.user.findMany({ where: { id: { in: repIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name.trim()])
  );

  const candidates = clusters
    .filter((k) => k.v / voted >= 0.05)
    .slice(0, MAX_CANDIDATES)
    .map((k, i) => {
      const byRep = new Map<string, number>();
      for (const m of k.members) byRep.set(m.rep, (byRep.get(m.rep) ?? 0) + m.v);
      const rep = [...byRep.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const minutes = k.members.map((m) => m.minutes);
      const days = [...new Set(k.members.map((m) => m.day))].sort();
      return {
        label: String.fromCharCode(65 + i),
        lat: k.c.lat,
        lng: k.c.lng,
        share: k.v / voted,
        days: days.length,
        minutesMin: Math.round(Math.min(...minutes)),
        minutesMax: Math.round(Math.max(...minutes)),
        repName: names.get(rep) ?? "торговий",
        lastDay: days.at(-1)!,
        distanceM: current ? Math.round(meters(k.c, current)) : 0,
      };
    });

  return {
    name: client.name,
    current,
    votedDocs: voted,
    candidates,
    confident: !!candidates[0] && candidates[0].share >= AUTO_MIN_SHARE && voted >= AUTO_MIN_DOCS,
    note: candidates.length ? null : "Голоси замовлень розпорошені — жодне місце не набрало помітної частки.",
  };
}
