/**
 * Поділ треку на їзду, ходьбу й стоянки — арифметика без мережі й бази.
 *
 * Запуск:  npx tsx scripts/check-movement-parts.ts
 *
 * Заради чого. Цей поділ тепер малює карта дня водія, і від нього залежить
 * не лише вигляд: суцільна лінія показувала вивантаження на ринку як
 * поїздку кварталом, тобто накручувала «зайві» кілометри в очах керівника.
 * Помилка тут проявиться не винятком, а неправильним малюнком — тому
 * перевіряємо числа.
 *
 * Мережі не торкаємось: splitByMovement із onRoads=false не ходить в OSRM.
 */

import { classifyMovement, movementTotals } from "@/lib/track/movement";
import { splitByMovement } from "@/lib/track/movement-parts";
import { findStops } from "@/lib/track/stops";

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

/** Один градус широти ≈ 111 км: рахуємо зсув за швидкістю й часом. */
function north(lat: number, km: number): number {
  return lat + km / 111;
}

const START = new Date("2026-09-04T06:00:00Z");
const BASE_LAT = 49.84;
const BASE_LNG = 24.03;

type P = { lat: number; lng: number; recordedAt: Date };

/** Синтетичний день: їзда 10 хв → стоянка 8 хв → 5 хв пішки → їзда 10 хв. */
function buildDay(): P[] {
  const pts: P[] = [];
  let lat = BASE_LAT;
  let t = START.getTime();
  const push = () => pts.push({ lat, lng: BASE_LNG, recordedAt: new Date(t) });
  push();

  // Їзда 40 км/год, точка раз на хвилину — 10 хвилин.
  for (let i = 0; i < 10; i++) {
    t += 60_000;
    lat = north(lat, 40 / 60);
    push();
  }
  // Стоянка: 8 хвилин на місці (дрейф приймача не імітуємо — він тут зайвий).
  for (let i = 0; i < 8; i++) {
    t += 60_000;
    push();
  }
  // Ходьба 4 км/год, 5 хвилин.
  for (let i = 0; i < 5; i++) {
    t += 60_000;
    lat = north(lat, 4 / 60);
    push();
  }
  // Знову їзда, 10 хвилин.
  for (let i = 0; i < 10; i++) {
    t += 60_000;
    lat = north(lat, 40 / 60);
    push();
  }
  return pts;
}

async function main() {
  const day = buildDay();
  const segments = classifyMovement(day);
  const parts = await splitByMovement(day, false);

  check("Кількість шматків дорівнює кількості відрізків руху", parts.length === segments.length, {
    шматків: parts.length,
    відрізків: segments.length,
  });

  check(
    "Режими шматків збігаються з розбором руху",
    parts.every((p, i) => p.mode === segments[i].mode),
    parts.map((p) => p.mode)
  );

  check(
    "У дні є і їзда, і стоянка",
    parts.some((p) => p.mode === "DRIVE") && parts.some((p) => p.mode === "STOP"),
    parts.map((p) => `${p.mode}:${p.km}`)
  );

  /**
   * Сусідні шматки МУСЯТЬ ділити спільну вершину — інакше на карті між
   * поїздкою і ходьбою з'явиться діра, яка читається як пропав трек.
   */
  const joined = parts.every((p, i) => {
    if (i === 0 || p.path.length === 0) return true;
    const prev = parts[i - 1].path;
    if (prev.length === 0) return true;
    const a = prev[prev.length - 1];
    const b = p.path[0];
    return a[0] === b[0] && a[1] === b[1];
  });
  check("Сусідні шматки стикуються спільною точкою", joined);

  const totals = movementTotals(segments);
  const sumParts = Math.round(parts.reduce((s, p) => s + p.km, 0) * 10) / 10;
  const sumTotals = Math.round((totals.DRIVE.km + totals.WALK.km + totals.STOP.km) * 10) / 10;
  check("Сума кілометрів шматків збігається з підсумками руху", sumParts === sumTotals, {
    шматки: sumParts,
    підсумки: sumTotals,
  });

  check("Їзда набагато довша за ходьбу", totals.DRIVE.km > totals.WALK.km * 3, totals);

  /**
   * Підпис зупинки клієнтом — здогад із межею 150 м. Ширша межа почала б
   * підписувати зупинки навмання: координати частини клієнтів уточнені
   * лише до міста.
   */
  const stopSeg = segments.find((s) => s.mode === "STOP");
  if (!stopSeg) {
    check("У дні знайдено стоянку", false);
  } else {
    const at = day[stopSeg.start];
    const near = findStops(day, [
      { counterpartyId: "c1", name: "Магазин поруч", lat: at.lat, lng: at.lng },
    ]);
    check(
      "Клієнт за десяток метрів підписує зупинку",
      near.some((s) => s.counterpartyId === "c1"),
      near.map((s) => s.counterpartyName)
    );

    const far = findStops(day, [
      { counterpartyId: "c2", name: "Далекий", lat: north(at.lat, 0.3), lng: at.lng },
    ]);
    check(
      "Клієнт за 300 метрів зупинку НЕ підписує",
      far.every((s) => s.counterpartyId === null),
      far.map((s) => s.counterpartyName)
    );
  }

  console.log(failed === 0 ? "\nУсе зійшлося." : `\nПровалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
