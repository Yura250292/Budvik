/**
 * Точки клієнтів із треку торгового: де він стоїть у дні їхніх документів.
 *
 *   npx tsx --env-file=.env scripts/pins-from-track.mts            # перегляд + самоперевірка
 *   npx tsx --env-file=.env scripts/pins-from-track.mts --apply    # запис
 *
 * Навіщо. Сотні клієнтів стоять у центрі міста (geoSource CITY): у картці
 * чітка адреса — «м.Бібрка, Крушельницької 3», — а OpenStreetMap такої
 * вулиці в малому місті не знає, і геокодер ставить пін на площу. Для
 * маршруту це фікція: оптимізатор вважає, що всі клієнти міста в одній точці.
 *
 * Адреса не допоможе, а трек — так. Торговий фізично стоїть біля магазину в
 * дні, коли в клієнта зʼявляється документ. Скалоцька (Бібрка): 4 дні з
 * треком — 27.08, 03.09, 10.09, 18.09 — і всі 4 рази Олександр по 13–17 хв
 * стояв в одному й тому самому місці, а інші його стоянки в Бібрці
 * припадали на дні без її документів.
 *
 * Правило. Для клієнта C із «приблизною» точкою і торгового R:
 *   - дні документів C від R, у які в R є трек, — «дні клієнта»;
 *   - стоянки R (≥5 хв, findStops) у межах CITY_RADIUS_KM від нинішньої
 *     точки C за ВЕСЬ період, згруповані в місця радіусом CLUSTER_M;
 *   - місце, де R стояв у найбільшу кількість днів клієнта.
 * Беремо, лише коли воно однозначне:
 *   - щонайменше MIN_HITS днів клієнта і не менше MIN_SHARE від усіх;
 *   - друге місце має строго менше таких днів — інакше не розвести
 *     сусідів, що замовляють в один день;
 *   - більшість днів, коли R там стояв, — дні цього клієнта (MIN_SPECIFIC):
 *     так відсіюються обід, заправка, дім і власний склад.
 *
 * Перш ніж писати, скрипт перевіряє сам себе на клієнтах, яким торгові
 * поставили точку РУКАМИ: вгадує їхнє місце тим самим правилом і міряє
 * промах. Якщо метод бреше там, де правда відома, писати не можна.
 *
 * СТАН НА 23.09.2026: --apply НЕ запускали. Самоперевірка показала межу
 * методу: торговий за один виїзд заходить до кількох клієнтів міста, і дні
 * їхніх документів збігаються. Скалоцька — місце A у 4 днях із 4, але місце
 * C — у 3 із 4, і хто з клієнтів де, із днів не видно. Найсуворіше правило
 * дало 3 точки зі 93 приблизних і все одно схибило на 3 км в 1 з 6
 * ручних перевірок (Ступницький, Дрогобич). Автоматичний запис переносив би
 * частину клієнтів на інший кінець міста, тож кандидатів має підтверджувати
 * людина, яка знає клієнта.
 *
 * Пише лише в картки з geoSource = 'CITY' (умова стоїть і в самому UPDATE):
 * ручну точку не перезапише ніколи. Нова мітка — GEOCODED: точка автоматична,
 * не людська; торговий на своїй карті й далі бачить «уточніть при візиті».
 * Перед записом — бекап старих координат у output/.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { findStops } from "../src/lib/track/stops";
import { isInternalClient, loadInternalContext } from "../src/lib/rep-feed/internal";

const APPLY = process.argv.includes("--apply");

const PERIOD_DAYS = 75;
const CITY_RADIUS_KM = 6;
const CLUSTER_M = 70;
const MIN_HITS = 2;
const MIN_SHARE = 0.6;
const MIN_SPECIFIC = 0.75;
/** Трек, у якому менше точок, — це не робочий день, а уривок. */
const MIN_DAY_POINTS = 40;

type Pt = { lat: number; lng: number };
const meters = (a: Pt, b: Pt) =>
  111_320 * Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180));
const kyivDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Kyiv" });

const since = new Date(Date.now() - PERIOD_DAYS * 86_400_000);

/* ── Документи: хто, кому, коли ───────────────────────────────────── */

const docRows = await prisma.salesDocument.findMany({
  where: { createdAt: { gte: since }, salesRepId: { not: null }, counterpartyId: { not: null }, docType: { not: "RETURN" } },
  select: { counterpartyId: true, salesRepId: true, createdAt: true },
});
/** `${repId}|${clientId}` → множина днів */
const docDays = new Map<string, Set<string>>();
for (const d of docRows) {
  const k = `${d.salesRepId}|${d.counterpartyId}`;
  const set = docDays.get(k) ?? new Set<string>();
  set.add(kyivDay(d.createdAt));
  docDays.set(k, set);
}
const reps = [...new Set(docRows.map((d) => d.salesRepId!))];

/* ── Стоянки кожного торгового за весь період ─────────────────────── */

type Stop = Pt & { day: string; minutes: number };
const stopsByRep = new Map<string, Stop[]>();
const trackDays = new Map<string, Set<string>>();
for (const rep of reps) {
  const pts = await prisma.trackPoint.findMany({
    where: { userId: rep, recordedAt: { gte: since } },
    orderBy: { recordedAt: "asc" },
    select: { lat: true, lng: true, recordedAt: true, speedKmh: true },
  });
  if (pts.length === 0) continue;
  const byDay = new Map<string, typeof pts>();
  for (const p of pts) {
    const d = kyivDay(p.recordedAt);
    const list = byDay.get(d) ?? [];
    list.push(p);
    byDay.set(d, list);
  }
  const stops: Stop[] = [];
  const days = new Set<string>();
  for (const [day, list] of byDay) {
    if (list.length < MIN_DAY_POINTS) continue;
    days.add(day);
    for (const s of findStops(list)) stops.push({ lat: s.lat, lng: s.lng, day, minutes: s.minutes });
  }
  stopsByRep.set(rep, stops);
  trackDays.set(rep, days);
}

/* ── Правило ─────────────────────────────────────────────────────── */

type Guess = { lat: number; lng: number; hits: number; of: number; specific: number; runnerUp: number; stops: number };

function guess(rep: string, clientId: string, around: Pt): Guess | null {
  const stops = (stopsByRep.get(rep) ?? []).filter((s) => meters(s, around) <= CITY_RADIUS_KM * 1000);
  /*
   * «Дні клієнта» — лише ті, коли торговий узагалі був у цьому місті.
   * Документ зʼявляється й після дзвінка: у Скалоцької 8 днів документів із
   * треком, а в Бібрці Олександр був у 4 — і всі 4 стояв в одному місці.
   * Телефонне замовлення не свідчить ні за, ні проти точки.
   */
  const inTown = new Set(stops.map((s) => s.day));
  const clientDays = [...(docDays.get(`${rep}|${clientId}`) ?? [])].filter((d) => inTown.has(d));
  if (clientDays.length < MIN_HITS || stops.length === 0) return null;

  // Жадібна кластеризація: місце = центр стоянок у радіусі CLUSTER_M.
  const clusters: Array<{ c: Pt; members: Stop[] }> = [];
  for (const s of [...stops].sort((a, b) => b.minutes - a.minutes)) {
    const hit = clusters.find((k) => meters(k.c, s) <= CLUSTER_M);
    if (hit) {
      hit.members.push(s);
      const n = hit.members.length;
      hit.c = { lat: hit.members.reduce((a, m) => a + m.lat, 0) / n, lng: hit.members.reduce((a, m) => a + m.lng, 0) / n };
    } else clusters.push({ c: { lat: s.lat, lng: s.lng }, members: [s] });
  }

  const cd = new Set(clientDays);
  const scored = clusters
    .map((k) => {
      const days = new Set(k.members.map((m) => m.day));
      const hits = [...days].filter((d) => cd.has(d)).length;
      return { k, days, hits };
    })
    .sort((a, b) => b.hits - a.hits || b.days.size - a.days.size);

  const best = scored[0];
  if (!best || best.hits < MIN_HITS) return null;
  const runnerUp = scored[1]?.hits ?? 0;
  const specific = best.hits / best.days.size;
  /*
   * Лідер має ЯВНО переважати. Сусіди, що замовляють в один день (чотири
   * клієнти Олександра в Бориславі), дають кожному з місць майже однакову
   * кількість днів, і «перемога на один день» віддавала клієнтові стоянку
   * біля сусіда: самоперевірка на ручних точках ловила це промахами до 5 км.
   */
  if (best.hits / clientDays.length < MIN_SHARE || runnerUp * 2 > best.hits || specific < MIN_SPECIFIC) return null;
  return { lat: best.k.c.lat, lng: best.k.c.lng, hits: best.hits, of: clientDays.length, specific, runnerUp, stops: best.k.members.length };
}

/** Торговий, який веде клієнта: найбільше днів документів. */
function leadRep(clientId: string): string[] {
  return reps
    .map((r) => ({ r, n: docDays.get(`${r}|${clientId}`)?.size ?? 0 }))
    .filter((x) => x.n > 0 && stopsByRep.has(x.r))
    .sort((a, b) => b.n - a.n)
    .map((x) => x.r);
}

/* ── Самоперевірка на ручних точках ──────────────────────────────── */

const manual = await prisma.counterparty.findMany({
  where: { geoSource: "MANUAL", deliveryLat: { not: null }, deliveryLng: { not: null } },
  select: { id: true, name: true, deliveryLat: true, deliveryLng: true },
});
const errs: number[] = [];
const bad: string[] = [];
for (const c of manual) {
  const truth = { lat: c.deliveryLat!, lng: c.deliveryLng! };
  for (const rep of leadRep(c.id)) {
    const g = guess(rep, c.id, truth);
    if (!g) continue;
    const e = meters(g, truth);
    errs.push(e);
    if (e > 150) bad.push(`${c.name} — промах ${Math.round(e)} м (${g.hits}/${g.of} днів)`);
    break;
  }
}
errs.sort((a, b) => a - b);
const q = (p: number) => (errs.length ? Math.round(errs[Math.min(errs.length - 1, Math.floor(p * errs.length))]) : 0);
console.log(`САМОПЕРЕВІРКА на ${manual.length} ручних точках: правило дало відповідь для ${errs.length}`);
console.log(`  промах: медіана ${q(0.5)} м, 80% — до ${q(0.8)} м, 95% — до ${q(0.95)} м, найбільший ${q(1)} м`);
console.log(`  у межах 100 м: ${errs.filter((e) => e <= 100).length}, 100–150 м: ${errs.filter((e) => e > 100 && e <= 150).length}, далі 150 м: ${bad.length}`);
for (const b of bad) console.log(`    ✗ ${b}`);

/* ── Кандидати: приблизні точки ──────────────────────────────────── */

const internal = await loadInternalContext();
const city = await prisma.counterparty.findMany({
  where: { geoSource: "CITY", deliveryLat: { not: null }, deliveryLng: { not: null } },
  select: { id: true, name: true, code: true, address: true, deliveryLat: true, deliveryLng: true },
});
const found: Array<{ id: string; code: string | null; name: string; address: string | null; from: Pt; to: Pt; rep: string; g: Guess }> = [];
let noDocs = 0;
for (const c of city) {
  if (isInternalClient({ id: c.id, name: c.name }, internal)) continue;
  const from = { lat: c.deliveryLat!, lng: c.deliveryLng! };
  const lead = leadRep(c.id);
  if (!lead.length) { noDocs++; continue; }
  for (const rep of lead) {
    const g = guess(rep, c.id, from);
    if (g) { found.push({ id: c.id, code: c.code, name: c.name, address: c.address, from, to: g, rep, g }); break; }
  }
}
const repNames = new Map((await prisma.user.findMany({ where: { id: { in: reps } }, select: { id: true, name: true } })).map((u) => [u.id, u.name.trim()]));

console.log(`\nПРИБЛИЗНИХ точок (CITY): ${city.length}; без документів торгового з треком: ${noDocs}; правило впевнене: ${found.length}`);
for (const f of found.sort((a, b) => b.g.hits - a.g.hits)) {
  console.log(`  ${(f.code ?? "").padEnd(10)} ${f.name.slice(0, 48).padEnd(48)} | ${repNames.get(f.rep)} ${f.g.hits}/${f.g.of} дн., точність місця ${Math.round(f.g.specific * 100)}% | зсув ${Math.round(meters(f.from, f.to))} м → ${f.to.lat.toFixed(5)}, ${f.to.lng.toFixed(5)}`);
}

if (!APPLY) {
  console.log("\nРежим перегляду: у базу нічого не записано. Запис — з --apply.");
  await prisma.$disconnect();
  process.exit(0);
}

/* ── Запис ───────────────────────────────────────────────────────── */

mkdirSync("output", { recursive: true });
const backup = `output/pins-from-track-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
writeFileSync(backup, JSON.stringify(found.map((f) => ({ id: f.id, code: f.code, name: f.name, lat: f.from.lat, lng: f.from.lng, geoSource: "CITY" })), null, 2));
let written = 0;
for (const f of found) {
  written += await prisma.$executeRaw`
    UPDATE "Counterparty"
    SET "deliveryLat" = ${f.to.lat}, "deliveryLng" = ${f.to.lng},
        "geoSource" = 'GEOCODED', "geoAttemptedAt" = NOW()
    WHERE id = ${f.id} AND "geoSource" = 'CITY'`;
}
console.log(`\nЗаписано: ${written} з ${found.length}. Бекап старих координат: ${backup}`);
await prisma.$disconnect();
