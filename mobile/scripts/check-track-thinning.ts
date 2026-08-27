/**
 * Перевірка арифметики проріджування треку.
 *
 * Запуск:  npx tsx scripts/check-track-thinning.ts
 *
 * Заради чого. Ці числа визначають довжину лінії маршруту, а з неї рахується
 * кілометраж — тобто зарплата водія. Помилка тут не падає й не світиться в
 * логах: вона просто дає інший пробіг. На пристрої це не перевіриш швидко, а
 * арифметику — можна й треба.
 *
 * Логіка навмисно повторена тут, а не імпортована з recorder.ts: той модуль
 * тягне expo-location і SQLite, яких поза застосунком немає. Тому будь-яка
 * зміна порогів мусить бути внесена у ДВА місця — і саме розбіжність між ними
 * цей скрипт і ловить, звіряючи константи з вихідним кодом.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const MOVE_M = 25;
const IDLE_WRITE_MS = 60_000;
const MAX_ACCURACY_M = 1000;
const MAX_SPEED_KMH = 150;

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail === undefined ? "" : `\n    ${JSON.stringify(detail)}`}`);
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Те саме рішення, що ухвалює recorder.onLocations для однієї точки. */
function shouldWrite(
  last: { at: number; lat: number; lng: number } | null,
  next: { at: number; lat: number; lng: number; accuracyM: number | null }
): boolean {
  if (next.accuracyM != null && next.accuracyM > MAX_ACCURACY_M) return false;
  if (!last) return true;
  const moved = haversineM(last.lat, last.lng, next.lat, next.lng);
  const waited = next.at - last.at;
  return moved >= MOVE_M || waited >= IDLE_WRITE_MS;
}

// --- 1. Константи в коді збігаються з тими, що перевіряємо ---
const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "../src/track/recorder.ts"), "utf8");
for (const [name, value] of [
  ["MAX_ACCURACY_M", MAX_ACCURACY_M],
  ["MOVE_M", MOVE_M],
  ["IDLE_WRITE_MS", IDLE_WRITE_MS],
  ["MAX_SPEED_KMH", MAX_SPEED_KMH],
] as const) {
  const m = src.match(new RegExp(`const ${name} = ([0-9_]+)`));
  const inCode = m ? Number(m[1].replace(/_/g, "")) : null;
  check(`${name} у recorder.ts = ${value}`, inCode === value, { inCode, expected: value });
}

// --- 2. Відомі відстані ---
// Дві точки в центрі Львова, між якими по прямій ≈ 1,7 км.
const d = haversineM(49.8419, 24.0315, 49.8449, 24.0087);
check("Гаверсинус дає ~1.7 км на відомій парі", d > 1600 && d < 1800, Math.round(d));
check("Нульова відстань = 0", haversineM(49.84, 24.03, 49.84, 24.03) === 0);

// --- 3. Рішення про запис ---
const t0 = 1_700_000_000_000;
const base = { at: t0, lat: 49.8419, lng: 24.0315 };

check(
  "Перша точка пишеться завжди",
  shouldWrite(null, { at: t0, lat: 49.8419, lng: 24.0315, accuracyM: 10 })
);
check(
  "Похибка понад кілометр — точку відкинуто",
  !shouldWrite(null, { at: t0, lat: 49.8419, lng: 24.0315, accuracyM: 1500 })
);
check(
  "Дрейф на 5 м за 20 с — не пишемо",
  !shouldWrite(base, { at: t0 + 20_000, lat: 49.84194, lng: 24.03153, accuracyM: 8 })
);
check(
  "Той самий дрейф, але за 60 с — пишемо",
  shouldWrite(base, { at: t0 + 60_000, lat: 49.84194, lng: 24.03153, accuracyM: 8 })
);
check(
  "Проїхали 100 м за 20 с — пишемо",
  shouldWrite(base, { at: t0 + 20_000, lat: 49.8428, lng: 24.0315, accuracyM: 8 })
);

/**
 * Головне, заради чого все це: стоянка не має накручувати кілометраж.
 *
 * Година біля магазину з дрейфом приймача ±10 м на фікс раз на 20 секунд —
 * це 180 фіксів. Без проріджування вони дали б кілометри «пробігу».
 */
let last: { at: number; lat: number; lng: number } | null = base;
let written = 0;
for (let i = 1; i <= 180; i++) {
  const jitterLat = 49.8419 + (i % 2 === 0 ? 0.00008 : -0.00008);
  const jitterLng = 24.0315 + (i % 3 === 0 ? 0.00008 : -0.00008);
  const p = { at: t0 + i * 20_000, lat: jitterLat, lng: jitterLng, accuracyM: 12 };
  if (shouldWrite(last, p)) {
    written++;
    last = { at: p.at, lat: p.lat, lng: p.lng };
  }
}
check(
  "Година на стоянці: 180 фіксів → не більше 60 записів",
  written <= 60,
  { фіксів: 180, записано: written }
);

// --- 4. Стеля швидкості ---
const speedKmh = (ms: number) => Math.min(Math.round(ms * 3.6), MAX_SPEED_KMH);
check("90 км/год лишається 90", speedKmh(25) === 90, speedKmh(25));
check("Збій приймача (300 м/с) зрізано до 150", speedKmh(300) === 150, speedKmh(300));

// --- 5. Пороги «приймач замовк» мусять бути кратно більші за інтервал запису ---
/**
 * Інакше перепідписка крутилася б безкінечно: поріг, порівнянний з інтервалом,
 * спрацьовував би на кожній нормальній паузі між фіксами.
 */
const healthSrc = readFileSync(join(HERE, "../src/track/health.ts"), "utf8");
const ctrlSrc = readFileSync(join(HERE, "../src/track/controller.ts"), "utf8");

const staleShift = Number(healthSrc.match(/SHIFT: (\d+) \* 60_000/)?.[1]);
const staleAfter = Number(healthSrc.match(/AFTER_SHIFT: (\d+) \* 60_000/)?.[1]);
const intervals = [...ctrlSrc.matchAll(/timeInterval: ([0-9_]+)/g)].map((m) => Number(m[1].replace(/_/g, "")) / 1000);

check("Поріг тиші в зміні знайдено", Number.isFinite(staleShift), staleShift);
check("Поріг тиші після зміни знайдено", Number.isFinite(staleAfter), staleAfter);
check("Інтервали запису знайдено (2)", intervals.length === 2, intervals);

if (intervals.length === 2) {
  const [shiftSec, afterSec] = intervals;
  check(
    `Поріг у зміні (${staleShift} хв) ≥ 10 інтервалів (${shiftSec} с)`,
    staleShift * 60 >= shiftSec * 10,
    { поріг_с: staleShift * 60, інтервал_с: shiftSec }
  );
  check(
    `Поріг після зміни (${staleAfter} хв) ≥ 3 інтервали (${afterSec} с)`,
    staleAfter * 60 >= afterSec * 3,
    { поріг_с: staleAfter * 60, інтервал_с: afterSec }
  );
}

/** Повтор не частіше ніж поріг — інакше перезапуски накладаються один на одного. */
const minRetry = Number(healthSrc.match(/MIN_RETRY_MS = (\d+) \* 60_000/)?.[1]);
check(
  `Пауза між перепідписками (${minRetry} хв) ≥ порогу зміни (${staleShift} хв)`,
  minRetry >= staleShift,
  { minRetry, staleShift }
);

console.log(failed === 0 ? "\nУсе зійшлося." : `\nПровалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
