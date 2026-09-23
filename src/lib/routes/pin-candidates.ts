/**
 * Де торговий стояв у дні документів клієнта — кандидати на його точку.
 *
 * Навіщо. Сотні клієнтів стоять у центрі міста (geoSource CITY): адреса в
 * картці чітка — «м.Бібрка, Крушельницької 3», — а OpenStreetMap такої
 * вулиці в малому місті не знає. Торговий же фізично стоїть біля магазину
 * в дні, коли в клієнта зʼявляється документ. Скалоцька: 4 дні з треком у
 * Бібрці — і всі 4 рази Олександр по 13–17 хв стояв в одному місці.
 *
 * Чому кандидати, а не відповідь. Торговий за один виїзд заходить до
 * кількох клієнтів міста, і дні їхніх документів збігаються: у тієї ж
 * Скалоцької поруч із «4 з 4» стоїть місце «3 з 4» — інший клієнт. Автомат
 * тут промахувався на кілометри (scripts/pins-from-track.mts, самоперевірка
 * на ручних точках), а людина, яка знає клієнта, вибирає за секунду.
 *
 * Лише читання: точку ставить звичайний PATCH /api/admin/client-map/[id].
 */

import { prisma } from "@/lib/prisma";
import { findStops } from "@/lib/track/stops";

/** Скільки днів назад дивимось. */
const PERIOD_DAYS = 90;
/** Радіус «того самого міста» довкола нинішньої приблизної точки. */
const TOWN_RADIUS_KM = 6;
/** Стоянки ближче за це — одне місце. */
const CLUSTER_M = 70;
/** Скільки кандидатів показувати: більше — людина вже не вибирає, а гортає. */
const MAX_CANDIDATES = 4;

export type PinCandidate = {
  /** Мітка на карті й у списку: A, B, C… */
  label: string;
  lat: number;
  lng: number;
  /** У скільки днів документів цього клієнта торговий тут стояв… */
  clientDays: number;
  /** …із тих днів документів, коли він узагалі був у місті. */
  clientDaysInTown: number;
  /** Скільки всього різних днів він тут стояв (і для інших клієнтів теж). */
  allDays: number;
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
  candidates: PinCandidate[];
  /** Чому кандидатів немає — людською мовою. */
  note: string | null;
};

type Pt = { lat: number; lng: number };
const meters = (a: Pt, b: Pt) =>
  111_320 * Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180));
const kyivDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });

export async function pinCandidates(counterpartyId: string): Promise<PinCandidatesResult | null> {
  const client = await prisma.counterparty.findUnique({
    where: { id: counterpartyId },
    select: { name: true, deliveryLat: true, deliveryLng: true },
  });
  if (!client) return null;
  if (client.deliveryLat == null || client.deliveryLng == null) {
    return { name: client.name, current: null, candidates: [], note: "У клієнта немає навіть приблизної точки — нема від чого шукати місто." };
  }
  const center = { lat: client.deliveryLat, lng: client.deliveryLng };
  const since = new Date(Date.now() - PERIOD_DAYS * 86_400_000);

  const docs = await prisma.salesDocument.findMany({
    where: { counterpartyId, createdAt: { gte: since }, salesRepId: { not: null }, docType: { not: "RETURN" } },
    select: { salesRepId: true, createdAt: true },
  });
  const docDays = new Map<string, Set<string>>();
  for (const d of docs) {
    const set = docDays.get(d.salesRepId!) ?? new Set<string>();
    set.add(kyivDay(d.createdAt));
    docDays.set(d.salesRepId!, set);
  }
  if (docDays.size === 0) {
    return { name: client.name, current: center, candidates: [], note: `За ${PERIOD_DAYS} днів у клієнта немає документів торгового — нема з чим звіряти трек.` };
  }

  const dLat = TOWN_RADIUS_KM / 111;
  const dLng = TOWN_RADIUS_KM / (111 * Math.cos((center.lat * Math.PI) / 180));
  const repNames = new Map(
    (await prisma.user.findMany({ where: { id: { in: [...docDays.keys()] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name.trim()])
  );

  type Stop = Pt & { day: string; minutes: number; rep: string };
  const stops: Stop[] = [];
  for (const rep of docDays.keys()) {
    // Лише точки в межах міста: цього досить, щоб знайти стоянки в ньому,
    // і в рази менше, ніж увесь трек за три місяці.
    const pts = await prisma.trackPoint.findMany({
      where: {
        userId: rep,
        recordedAt: { gte: since },
        lat: { gte: center.lat - dLat, lte: center.lat + dLat },
        lng: { gte: center.lng - dLng, lte: center.lng + dLng },
      },
      orderBy: { recordedAt: "asc" },
      select: { lat: true, lng: true, recordedAt: true, speedKmh: true },
    });
    const byDay = new Map<string, typeof pts>();
    for (const p of pts) {
      const d = kyivDay(p.recordedAt);
      const list = byDay.get(d) ?? [];
      list.push(p);
      byDay.set(d, list);
    }
    for (const [day, list] of byDay) {
      for (const s of findStops(list)) {
        if (meters(s, center) <= TOWN_RADIUS_KM * 1000) stops.push({ lat: s.lat, lng: s.lng, day, minutes: s.minutes, rep });
      }
    }
  }
  if (stops.length === 0) {
    return { name: client.name, current: center, candidates: [], note: "Трек торгового не показує жодної стоянки в цьому місті — або він ще не писав трек, коли тут бував." };
  }

  // Місця: жадібно, довші стоянки першими — вони точніші.
  const clusters: Array<{ c: Pt; members: Stop[] }> = [];
  for (const s of [...stops].sort((a, b) => b.minutes - a.minutes)) {
    const hit = clusters.find((k) => meters(k.c, s) <= CLUSTER_M);
    if (hit) {
      hit.members.push(s);
      const n = hit.members.length;
      hit.c = { lat: hit.members.reduce((a, m) => a + m.lat, 0) / n, lng: hit.members.reduce((a, m) => a + m.lng, 0) / n };
    } else clusters.push({ c: { lat: s.lat, lng: s.lng }, members: [s] });
  }

  // «Дні клієнта в місті» — окремо для кожного торгового: телефонне
  // замовлення не свідчить ні за, ні проти місця.
  const inTownByRep = new Map<string, Set<string>>();
  for (const s of stops) {
    const set = inTownByRep.get(s.rep) ?? new Set<string>();
    set.add(s.day);
    inTownByRep.set(s.rep, set);
  }

  const scored = clusters.map((k) => {
    // Місце належить тому торговому, який стояв тут найчастіше.
    const byRep = new Map<string, number>();
    for (const m of k.members) byRep.set(m.rep, (byRep.get(m.rep) ?? 0) + 1);
    const rep = [...byRep.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const days = new Set(k.members.filter((m) => m.rep === rep).map((m) => m.day));
    const cd = docDays.get(rep) ?? new Set<string>();
    const inTown = [...cd].filter((d) => inTownByRep.get(rep)?.has(d));
    const clientDays = [...days].filter((d) => cd.has(d)).length;
    const minutes = k.members.map((m) => m.minutes);
    return {
      k,
      rep,
      clientDays,
      clientDaysInTown: inTown.length,
      allDays: days.size,
      minutesMin: Math.round(Math.min(...minutes)),
      minutesMax: Math.round(Math.max(...minutes)),
      lastDay: [...days].sort().at(-1)!,
    };
  });

  const candidates = scored
    .filter((s) => s.clientDays > 0)
    .sort((a, b) => b.clientDays - a.clientDays || a.allDays - b.allDays)
    .slice(0, MAX_CANDIDATES)
    .map((s, i) => ({
      label: String.fromCharCode(65 + i),
      lat: s.k.c.lat,
      lng: s.k.c.lng,
      clientDays: s.clientDays,
      clientDaysInTown: s.clientDaysInTown,
      allDays: s.allDays,
      minutesMin: s.minutesMin,
      minutesMax: s.minutesMax,
      repName: repNames.get(s.rep) ?? "торговий",
      lastDay: s.lastDay,
      distanceM: Math.round(meters(s.k.c, center)),
    }));

  return {
    name: client.name,
    current: center,
    candidates,
    note: candidates.length
      ? null
      : "Торговий бував у місті, але в дні документів цього клієнта не зупинявся ніде надовше за 5 хвилин.",
  };
}
