/**
 * Перевірка добору розривів треку реальною дорогою.
 *
 * Задача, яку це закриває: коли планшет був офлайн, дві сусідні точки
 * з'єднувались прямою через півміста, і в пробіг ішла хорда — коротша за
 * дорогу. На реальному дні водія два таких розриви дали 15,74 км із
 * 15,76 км «пробігу», тобто майже весь показник був прямими лініями.
 *
 * Мережу не чіпаємо: resolveGaps перевіряється на підставних відповідях,
 * а findGaps і buildTrackPath — чисті функції. Тому набір ганяється без
 * бази й без інтернету: npx tsx scripts/check-track-gaps.ts
 */

import { preparePoints } from "../src/lib/track/geo";
import { findGaps, buildTrackPath, MAX_GAPS_PER_RUN } from "../src/lib/track/gaps";

let failed = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failed++;
    console.log(`  ✗ ${name}\n      маємо: ${JSON.stringify(got)}\n      треба: ${JSON.stringify(want)}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
}

function ok(name: string, cond: boolean) {
  if (!cond) {
    failed++;
    console.log(`  ✗ ${name}`);
  } else {
    console.log(`  ✓ ${name}`);
  }
}

const t = (min: number) => new Date(Date.UTC(2026, 7, 12, 9, min, 0)).toISOString();

console.log("\nПозначення розривів");
{
  // Львів: Підзамче → Сокільники, ~6 км по прямій, 30 хвилин мовчання
  const r = preparePoints([
    { lat: 49.8555, lng: 24.0325, recordedAt: t(0), accuracyM: 10 },
    { lat: 49.8000, lng: 24.0100, recordedAt: t(30), accuracyM: 10 },
  ]);
  check("Обидві точки прийнято", r.points.length, 2);
  check("Перша точка не розрив", r.points[0].isGap, false);
  ok("Друга точка — розрив", r.points[1].isGap === true);
  ok("Відстань по прямій ~6 км", Math.abs((r.points[1].metersFromPrev ?? 0) - 6200) < 400);
}

console.log("\nЩільний трек розривами не вважається");
{
  // Кожні 15 секунд по 40 метрів — звичайна їзда з увімкненим планшетом
  const raw = Array.from({ length: 10 }, (_, i) => ({
    lat: 49.84 + i * 0.00036,
    lng: 24.03,
    recordedAt: new Date(Date.UTC(2026, 7, 12, 9, 0, i * 15)).toISOString(),
    accuracyM: 8,
  }));
  const r = preparePoints(raw);
  ok("Жодної точки не позначено розривом", r.points.every((p) => !p.isGap));
  check("Розривів не знайдено", findGaps(r.points).length, 0);
}

console.log("\nСтрибок GPS не стає розривом");
{
  // 8 км за 1 хвилину — 480 км/год, це перечеплення на іншу вежу
  const r = preparePoints([
    { lat: 49.84, lng: 24.03, recordedAt: t(0), accuracyM: 10 },
    { lat: 49.91, lng: 24.03, recordedAt: t(1), accuracyM: 10 },
  ]);
  check("Стрибок не рахується в пробіг", r.points[1].countsToDistance, false);
  check("І розривом теж не є — нема чого добирати", r.points[1].isGap, false);
}

console.log("\nfindGaps: звідки і куди");
{
  const r = preparePoints([
    { lat: 49.8555, lng: 24.0325, recordedAt: t(0), accuracyM: 10 },
    { lat: 49.8000, lng: 24.0100, recordedAt: t(30), accuracyM: 10 },
  ]);
  const gaps = findGaps(r.points);
  check("Знайдено один розрив", gaps.length, 1);
  check("Індекс кінцевої точки", gaps[0].index, 1);
  ok("Початок — попередня точка", Math.abs(gaps[0].from.lat - 49.8555) < 1e-6);
  ok("Кінець — поточна точка", Math.abs(gaps[0].to.lat - 49.8) < 1e-6);
  ok("Пряма додатна", gaps[0].straightM > 0);
}

console.log("\nРозрив на межі пачок");
{
  // Перша точка нової пачки далеко від останньої збереженої: планшет
  // мовчав між флашами, і саме тут пробіг занижувався найчастіше.
  const prev = { lat: 49.8555, lng: 24.0325, recordedAt: new Date(t(0)) };
  const r = preparePoints([{ lat: 49.8, lng: 24.01, recordedAt: t(30), accuracyM: 10 }], prev);
  ok("Точку позначено розривом", r.points[0].isGap === true);
  const gaps = findGaps(r.points, prev);
  check("Розрив знайдено з опорою на попередню", gaps.length, 1);
  ok("Початок узято з бази", Math.abs(gaps[0].from.lat - 49.8555) < 1e-6);
}
{
  // Без опори на попередню точку розрив нема від чого міряти
  const r = preparePoints([{ lat: 49.8, lng: 24.01, recordedAt: t(30), accuracyM: 10 }]);
  check("Перша точка дня — не розрив", r.points[0].isGap, false);
  check("І в findGaps не потрапляє", findGaps(r.points).length, 0);
}

console.log("\nbuildTrackPath: дорога замість прямої");
{
  const line = {
    type: "LineString",
    coordinates: [
      [24.0325, 49.8555],
      [24.02, 49.83],
      [24.01, 49.8],
    ],
  };
  const path = buildTrackPath([
    { lat: 49.8555, lng: 24.0325 },
    { lat: 49.8, lng: 24.01, gapGeometry: line },
  ]);
  check("Вершину початку не задвоєно", path.length, 3);
  check("Порядок [lat, lng]", path[1], [49.83, 24.02]);
  check("Кінець збігається з точкою", path[2], [49.8, 24.01]);
}
{
  const path = buildTrackPath([
    { lat: 49.84, lng: 24.03 },
    { lat: 49.85, lng: 24.04 },
  ]);
  check("Без розривів — точки як були", path, [
    [49.84, 24.03],
    [49.85, 24.04],
  ]);
}

console.log("\nbuildTrackPath: сміття в Json не валить карту");
{
  const bad = [
    null,
    undefined,
    "LineString",
    { type: "Point", coordinates: [24, 49] },
    { type: "LineString" },
    { type: "LineString", coordinates: [] },
    { type: "LineString", coordinates: [[24, 49]] }, // одна вершина — не лінія
  ];
  for (const g of bad) {
    const path = buildTrackPath([{ lat: 49.84, lng: 24.03, gapGeometry: g }]);
    ok(`Ігнорує ${JSON.stringify(g)?.slice(0, 34) ?? "undefined"}`, path.length === 1);
  }
}

console.log("\nЛіміт запитів до OSRM");
{
  ok("Не більше 8 розривів за прохід", MAX_GAPS_PER_RUN === 8);
}

console.log(failed === 0 ? "\nУсе зійшлося." : `\n${failed} перевірок впало.`);
process.exit(failed === 0 ? 0 : 1);
