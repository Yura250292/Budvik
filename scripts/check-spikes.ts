/**
 * Вуса на треку — перевірка на вигаданих, але списаних із життя випадках.
 *
 * Кожен випадок нижче стався насправді й коштував кілометрів у чиємусь дні:
 *   npx tsx scripts/check-spikes.ts
 */

import { collapseSimultaneous, dropSpikes } from "../src/lib/track/spikes";

let failed = 0;
const check = (name: string, got: number, want: number) => {
  if (got === want) console.log(`  ✓ ${name}`);
  else {
    failed++;
    console.log(`  ✗ ${name}\n      лишилось точок: ${got}, треба ${want}`);
  }
};

const t = (sec: number) => new Date(Date.UTC(2026, 8, 4, 8, 0, sec));
/** ~0.0035° широти ≈ 390 м. */
const P = (lat: number, lng: number, sec: number, speedKmh: number | null) => ({
  lat, lng, recordedAt: t(sec), speedKmh,
});

console.log("\nВуси, які треба прибрати");
/** Передрій 04.09, 05:32: убік 377 м і назад за 21 с при нульовій швидкості. */
check(
  "Стоїть, а «проїхав» 750 м за 21 секунду",
  dropSpikes([
    P(49.8400, 24.0300, 0, 3),
    P(49.8435, 24.0300, 10, 0),
    P(49.8400, 24.0301, 21, 0),
  ]).length,
  2
);
/** Кулик 03.09, 07:13: сусіди їдуть, а середня точка звітує нуль. */
check(
  "Сусіди їдуть, середина каже «стою» й летить убік",
  dropSpikes([
    P(49.8400, 24.0300, 0, 57),
    P(49.8460, 24.0300, 12, 0),
    P(49.8402, 24.0303, 24, 71),
  ]).length,
  2
);

console.log("\nЩо чіпати НЕ можна");
check(
  "Справжній розворот: ті самі метри, але за чотири хвилини",
  dropSpikes([
    P(49.8400, 24.0300, 0, 40),
    P(49.8435, 24.0300, 120, 45),
    P(49.8400, 24.0301, 240, 42),
  ]).length,
  3
);
check(
  "Дрібне тремтіння на місці — не вус",
  dropSpikes([
    P(49.84000, 24.03000, 0, 0),
    P(49.84025, 24.03000, 20, 0),
    P(49.84001, 24.03001, 40, 0),
  ]).length,
  3
);
check(
  "Звичайна пряма їзда",
  dropSpikes([
    P(49.8400, 24.0300, 0, 60),
    P(49.8435, 24.0300, 20, 62),
    P(49.8470, 24.0300, 40, 61),
  ]).length,
  3
);
check(
  "Швидкості немає зовсім, а геометрія можлива — лишаємо",
  dropSpikes([
    P(49.8400, 24.0300, 0, null),
    P(49.8435, 24.0300, 60, null),
    P(49.8400, 24.0301, 120, null),
  ]).length,
  3
);
check("Двох точок вистачити не може", dropSpikes([P(49.84, 24.03, 0, 0), P(49.85, 24.03, 20, 0)]).length, 2);

console.log("\nДва фікси в ту саму мить");
/** Передрій 04.09: 480 таких пар на 10,7 км чистої вигадки. */
check(
  "Дві точки за секунду за 80 м одна від одної — лишається точніша",
  collapseSimultaneous([
    { lat: 49.8400, lng: 24.0300, recordedAt: t(0), speedKmh: 0, accuracyM: 60 },
    { lat: 49.8407, lng: 24.0300, recordedAt: t(1), speedKmh: 0, accuracyM: 6 },
    { lat: 49.8500, lng: 24.0300, recordedAt: t(40), speedKmh: 50, accuracyM: 5 },
  ]).length,
  2
);
check(
  "Розбіжність менша за метри похибки — не чіпаємо",
  collapseSimultaneous([
    { lat: 49.84000, lng: 24.0300, recordedAt: t(0), speedKmh: 0, accuracyM: 6 },
    { lat: 49.84005, lng: 24.0300, recordedAt: t(1), speedKmh: 0, accuracyM: 8 },
  ]).length,
  2
);
check(
  "Двадцять секунд — це вже рух, а не одна мить",
  collapseSimultaneous([
    { lat: 49.8400, lng: 24.0300, recordedAt: t(0), speedKmh: 50, accuracyM: 6 },
    { lat: 49.8420, lng: 24.0300, recordedAt: t(20), speedKmh: 50, accuracyM: 30 },
  ]).length,
  2
);

console.log(failed === 0 ? "\nУсе зійшлося.\n" : `\nНе зійшлося: ${failed}.\n`);
process.exit(failed === 0 ? 0 : 1);
