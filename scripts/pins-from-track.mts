/**
 * Приблизні точки клієнтів (центр міста) → місце, де торговий набивав їхні замовлення.
 *
 *   npx tsx --env-file=.env scripts/pins-from-track.mts            # перегляд + самоперевірка
 *   npx tsx --env-file=.env scripts/pins-from-track.mts --apply    # запис упевнених
 *
 * Правило живе в src/lib/routes/pin-candidates.ts — те саме, що показує
 * попап «Де стояв торговий» на карті. Тут лише пакетний прогін.
 *
 * Перш ніж писати, скрипт перевіряє правило на клієнтах, яким торгові
 * поставили точку РУКАМИ: шукає їхнє місце так, ніби точки немає, і міряє
 * промах. Якщо впевнені відповіді там влучають (≤120 м) рідше ніж у
 * MIN_ACCURACY випадків або їх замало для висновку — запис не відбувається
 * навіть із --apply.
 *
 * Історія. Перша версія (дні документів без часу) промахувалась на кілометри:
 * торговий за виїзд заходить до кількох клієнтів міста, і дні їхніх
 * документів збігаються. Лікує час замовлення — див. шапку ядра.
 *
 * Пише лише в картки з geoSource = 'CITY' (умова стоїть і в самому UPDATE):
 * ручну точку не перезапише ніколи. Мітка — GEOCODED: точка автоматична,
 * не людська; торговий на своїй карті й далі бачить «уточніть при візиті».
 * Перед записом — бекап старих координат в output/.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { pinCandidates, type StopsCache } from "../src/lib/routes/pin-candidates";
import { isInternalClient, loadInternalContext } from "../src/lib/rep-feed/internal";

const APPLY = process.argv.includes("--apply");
const MIN_ACCURACY = 0.95;
const MIN_CHECKED = 20;
const HIT_M = 120;

const meters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  111_320 * Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180));
const cache: StopsCache = new Map();

/* ── Самоперевірка на ручних точках ──────────────────────────────── */

const manual = await prisma.counterparty.findMany({
  where: { geoSource: "MANUAL", deliveryLat: { not: null }, deliveryLng: { not: null } },
  select: { id: true, name: true, deliveryLat: true, deliveryLng: true },
});
let checked = 0;
let hits = 0;
const misses: string[] = [];
for (const c of manual) {
  const truth = { lat: c.deliveryLat!, lng: c.deliveryLng! };
  const r = await pinCandidates(c.id, { around: truth, cache });
  if (!r?.confident) continue;
  checked++;
  const e = meters(r.candidates[0], truth);
  if (e <= HIT_M) hits++;
  else misses.push(`${c.name} — промах ${Math.round(e)} м (${Math.round(r.candidates[0].share * 100)}% з ${r.votedDocs})`);
}
const accuracy = checked ? hits / checked : 0;
console.log(`САМОПЕРЕВІРКА: ${manual.length} ручних точок, упевнених відповідей ${checked}, влучно ≤${HIT_M} м: ${hits} (${Math.round(accuracy * 100)}%)`);
for (const m of misses) console.log(`   ✗ ${m}`);
const trusted = checked >= MIN_CHECKED && accuracy >= MIN_ACCURACY;
console.log(trusted ? "  → правилу можна вірити" : `  → запис ЗАБОРОНЕНО: потрібно ≥${MIN_CHECKED} перевірок і ≥${MIN_ACCURACY * 100}% влучань`);

/* ── Приблизні точки ─────────────────────────────────────────────── */

const internal = await loadInternalContext();
const city = await prisma.counterparty.findMany({
  where: { geoSource: "CITY", deliveryLat: { not: null }, deliveryLng: { not: null } },
  select: { id: true, name: true, code: true, deliveryLat: true, deliveryLng: true },
});
const sure: Array<{ id: string; code: string | null; name: string; from: { lat: number; lng: number }; to: { lat: number; lng: number }; line: string }> = [];
let unsure = 0;
let nothing = 0;
for (const c of city) {
  if (isInternalClient({ id: c.id, name: c.name }, internal)) continue;
  const r = await pinCandidates(c.id, { cache });
  if (!r || !r.candidates.length) { nothing++; continue; }
  const a = r.candidates[0];
  if (!r.confident) { unsure++; continue; }
  const from = { lat: c.deliveryLat!, lng: c.deliveryLng! };
  sure.push({
    id: c.id, code: c.code, name: c.name, from, to: { lat: a.lat, lng: a.lng },
    line: `${Math.round(a.share * 100)}% з ${r.votedDocs} замовлень · ${a.repName} · зсув ${Math.round(meters(from, a))} м → ${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}`,
  });
}
console.log(`\nПРИБЛИЗНИХ (CITY): ${city.length} — упевнених ${sure.length}, лише кандидати (для людини в попапі) ${unsure}, без даних ${nothing}`);
for (const s of sure) console.log(`  ${(s.code ?? "").padEnd(10)} ${s.name.slice(0, 50).padEnd(50)} | ${s.line}`);

if (!APPLY || !trusted) {
  console.log(`\n${APPLY ? "Запис скасовано самоперевіркою." : "Режим перегляду: у базу нічого не записано. Запис — з --apply."}`);
  await prisma.$disconnect();
  process.exit(0);
}

mkdirSync("output", { recursive: true });
const backup = `output/pins-from-track-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
writeFileSync(backup, JSON.stringify(sure.map((s) => ({ id: s.id, code: s.code, name: s.name, lat: s.from.lat, lng: s.from.lng, geoSource: "CITY" })), null, 2));
let written = 0;
for (const s of sure) {
  written += await prisma.$executeRaw`
    UPDATE "Counterparty"
    SET "deliveryLat" = ${s.to.lat}, "deliveryLng" = ${s.to.lng}, "geoSource" = 'GEOCODED', "geoAttemptedAt" = NOW()
    WHERE id = ${s.id} AND "geoSource" = 'CITY'`;
}
console.log(`\nЗаписано: ${written} з ${sure.length}. Бекап старих координат: ${backup}`);
await prisma.$disconnect();
