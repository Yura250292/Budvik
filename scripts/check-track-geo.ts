/**
 * Перевірка геоматематики веб-треку без бази.
 *
 * Запуск: npx tsx scripts/check-track-geo.ts
 *
 * Перевіряє те, від чого залежить пробіг у зарплаті: відстань між
 * реальними точками, відсів стрибків GPS, дрейф на стоянці, повторні
 * пачки і склеювання буфера після офлайну.
 */

import { haversineM, preparePoints, type RawPoint } from "../src/lib/track/geo";

let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? "" : `\n    очікували ${JSON.stringify(expected)}, отримали ${JSON.stringify(actual)}`}`);
}

function near(name: string, actual: number, expected: number, tolerance: number) {
  const ok = Math.abs(actual - expected) <= tolerance;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok ? ` (${actual.toFixed(2)})` : `\n    очікували ${expected} ±${tolerance}, отримали ${actual}`}`);
}

const at = (min: number) => new Date(Date.UTC(2026, 7, 12, 6, min, 0)).toISOString();

// --- Відстань ---
// Львів (площа Ринок) → Радехів: приблизно 64 км по прямій.
near("Львів → Радехів по прямій, км", haversineM(49.8419, 24.0315, 50.2836, 24.6383) / 1000, 64, 4);
near("Нульова відстань", haversineM(49.84, 24.03, 49.84, 24.03), 0, 0.001);

// --- Нормальна поїздка ---
{
  const raw: RawPoint[] = [
    { lat: 49.8419, lng: 24.0315, accuracyM: 10, recordedAt: at(0) },
    { lat: 49.8600, lng: 24.1000, accuracyM: 12, recordedAt: at(10) },
    { lat: 49.9000, lng: 24.2000, accuracyM: 8, recordedAt: at(25) },
  ];
  const r = preparePoints(raw, null);
  check("Прийнято всі 3 точки", r.points.length, 3);
  check("Перша точка без metersFromPrev", r.points[0].metersFromPrev, null);
  check("Перша точка не рахується в пробіг", r.points[0].countsToDistance, false);
  near("Пробіг пачки, км", r.addedKm, 13.5, 2);
  check("Немає відкинутих", r.rejected, { accuracy: 0, stale: 0, malformed: 0 });
}

// --- Стрибок GPS ---
{
  const raw: RawPoint[] = [
    { lat: 49.8419, lng: 24.0315, accuracyM: 10, recordedAt: at(0) },
    // 60+ км за одну хвилину — вежа перечепилася, а не машина полетіла
    { lat: 50.2836, lng: 24.6383, accuracyM: 20, recordedAt: at(1) },
  ];
  const r = preparePoints(raw, null);
  check("Стрибок збережено як точку", r.points.length, 2);
  check("Стрибок НЕ додано до пробігу", r.points[1].countsToDistance, false);
  near("Пробіг не зріс від стрибка", r.addedKm, 0, 0.001);
}

// --- Дрейф на стоянці ---
{
  const raw: RawPoint[] = [
    { lat: 49.84190, lng: 24.03150, accuracyM: 10, recordedAt: at(0) },
    { lat: 49.84195, lng: 24.03152, accuracyM: 15, recordedAt: at(3) },
    { lat: 49.84188, lng: 24.03149, accuracyM: 12, recordedAt: at(6) },
  ];
  const r = preparePoints(raw, null);
  near("Стоянка не додає пробігу", r.addedKm, 0, 0.001);
}

// --- Відсів за похибкою ---
{
  const raw: RawPoint[] = [
    { lat: 49.8419, lng: 24.0315, accuracyM: 10, recordedAt: at(0) },
    { lat: 49.8500, lng: 24.0500, accuracyM: 500, recordedAt: at(5) },
    { lat: 49.8600, lng: 24.1000, accuracyM: 20, recordedAt: at(10) },
  ];
  const r = preparePoints(raw, null);
  check("Точку з похибкою 500 м відкинуто", r.points.length, 2);
  check("Причина — accuracy", r.rejected.accuracy, 1);
}

// --- Повторна пачка (ідемпотентність) ---
{
  const raw: RawPoint[] = [
    { lat: 49.8419, lng: 24.0315, accuracyM: 10, recordedAt: at(0) },
    { lat: 49.8600, lng: 24.1000, accuracyM: 12, recordedAt: at(10) },
  ];
  const first = preparePoints(raw, null);
  const prev = {
    lat: first.points[1].lat,
    lng: first.points[1].lng,
    recordedAt: first.points[1].recordedAt,
  };
  const second = preparePoints(raw, prev);
  check("Повторна пачка не приймає жодної точки", second.points.length, 0);
  check("Усі як stale", second.rejected.stale, 2);
  near("Пробіг не подвоївся", second.addedKm, 0, 0.001);
}

// --- Перештампований дубль ---
// Ретрай, який ставить час відправки замість часу події: координата та
// сама, мітка новіша. Формально «новіша» точка, фактично — той самий
// момент, і без окремої перевірки вона подвоїла б рядок у треку.
{
  const prev = { lat: 49.8600, lng: 24.1000, recordedAt: new Date(at(10)) };
  const raw: RawPoint[] = [{ lat: 49.8600, lng: 24.1000, accuracyM: 12, recordedAt: at(12) }];
  const r = preparePoints(raw, prev);
  check("Дубль координати з новим часом відкинуто", r.points.length, 0);
  check("Порахований як stale", r.rejected.stale, 1);
}

// --- Продовження дня з попередньої точки ---
{
  const prev = { lat: 49.8419, lng: 24.0315, recordedAt: new Date(at(0)) };
  const raw: RawPoint[] = [{ lat: 49.8600, lng: 24.1000, accuracyM: 12, recordedAt: at(10) }];
  const r = preparePoints(raw, prev);
  check("Перша точка нової пачки має metersFromPrev", r.points[0].metersFromPrev !== null, true);
  check("І рахується в пробіг", r.points[0].countsToDistance, true);
  near("Розрив між пачками не втрачено, км", r.addedKm, 5.6, 1.5);
}

// --- Буфер після офлайну склеївся не по порядку ---
{
  const raw: RawPoint[] = [
    { lat: 49.9000, lng: 24.2000, accuracyM: 8, recordedAt: at(25) },
    { lat: 49.8419, lng: 24.0315, accuracyM: 10, recordedAt: at(0) },
    { lat: 49.8600, lng: 24.1000, accuracyM: 12, recordedAt: at(10) },
  ];
  const r = preparePoints(raw, null);
  check("Точки відсортовано за часом", r.points.map((p) => p.recordedAt.toISOString()), [at(0), at(10), at(25)]);
  near("Пробіг як у впорядкованої пачки, км", r.addedKm, 13.5, 2);
}

// --- Сміття ---
{
  const raw: RawPoint[] = [
    { lat: 999, lng: 24.03, accuracyM: 10, recordedAt: at(0) },
    { lat: 49.84, lng: 24.03, accuracyM: 10, recordedAt: "не-дата" },
    { lat: 49.84, lng: 24.03, accuracyM: 10, recordedAt: at(5) },
  ];
  const r = preparePoints(raw, null);
  check("Прийнято лише коректну точку", r.points.length, 1);
  check("Дві як malformed", r.rejected.malformed, 2);
}

console.log(failed === 0 ? "\nУсе зійшлося." : `\nПровалено перевірок: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
