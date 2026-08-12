/**
 * Друга спроба для клієнтів, що злиплися в центрі міста.
 *
 * Перший прохід віддав центр населеного пункту 156 клієнтам: у рядку
 * адреси стоїть не лише вулиця, а й назва магазину після слеша, орієнтир
 * у дужках, номер павільйону — Nominatim на такому здається і повертає
 * місто. Але сама вулиця там здебільшого є: «м..Львів, вул.Городницька,47
 * маг.Е1» — цілком робоча адреса, якщо прибрати хвіст.
 *
 * Такий пін гірший за відсутність піна: він виглядає точним, а насправді
 * каже лише «десь у цьому місті». Тому тут два виходи — або знайти
 * справжню вулицю, або чесно позначити точку як міську (CITY), щоб карта
 * могла показати її інакше.
 *
 * Запуск: npx tsx --env-file=.env scripts/regeocode-city-level.mts [--dry]
 */

import { PrismaClient } from "@prisma/client";
import { geocodeAddress } from "../src/lib/geo/nominatim";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

/**
 * Ринки Львова з перевіреними координатами.
 *
 * Окремих павільйонів у жодному довіднику немає, тож ціль — сам ринок:
 * це десятки метрів замість кілометрів до центру міста. Нижній Шувар
 * навмисно не шукаємо через Nominatim — там два Шувари за кілометр, і
 * пошук стабільно віддає не той (Верхній ТЦ на Червоної Калини).
 */
const MARKETS: Array<{ match: RegExp; lat: number; lng: number; label: string }> = [
  { match: /торпедо/i, lat: 49.865165, lng: 24.056877, label: "ринок Торпедо" },
  { match: /краківськ/i, lat: 49.8463445, lng: 24.0177547, label: "Краківський ринок" },
  { match: /нижній\s*шувар|шувар/i, lat: 49.7961, lng: 24.034774, label: "ринок Нижній Шувар" },
  { match: /привокзальн/i, lat: 49.8397, lng: 23.9944, label: "Привокзальний ринок" },
  { match: /перфецьког/i, lat: 49.8028, lng: 23.9909, label: "ринок на Перфецького" },
  { match: /галицьк(ий)?\s*ринок/i, lat: 49.8383, lng: 24.0322, label: "Галицький ринок" },
];

/**
 * Чистить адресу до того, що Nominatim здатен знайти.
 *
 * Прибирає назву магазину після слеша, орієнтири в дужках, «маг.»/«пав.»
 * з номером — усе, що для геокодера шум. Лишає місто, вулицю й будинок.
 */
function cleanAddress(raw: string): string | null {
  // Спершу знаходимо вулицю з номером — це єдине, що справді потрібне
  // геокодеру. Витягуємо, а не вичищаємо навколо: спроба «прибрати зайве»
  // регулярками по кирилиці ріже саму адресу (\b у JS не знає кирилиці,
  // тож «маг» ловиться всередині «Магерова», а «ряд» — у «Городницька»).
  const street = raw.match(
    /(вул|вулиц\w*|просп\w*|проспект|пл|площ\w*|пров|провул\w*|бульв\w*|шосе|наб\w*)[.\s]*([А-ЯІЇЄҐа-яіїєґ'\-\s]{3,32}?)[,\s]+(\d+[а-яА-Яa-zA-Z]?)/u
  );
  if (!street) return null;

  const [, kind, name, house] = street;
  const cleanName = name.replace(/\s{2,}/g, " ").trim();
  if (!cleanName) return null;

  // Населений пункт: «м.Львів», «смт.Шкло», «с.Солонка». Беремо ОСТАННІЙ
  // у рядку — «м. Львів, с.Солонка, вул.Стрийська» означає село Солонка
  // під Львовом, і вулиця там своя, не львівська.
  // Двослівні назви теж: «Новий Розділ», «Рава-Руська», «Кам'янка-Бузька».
  // Без другого слова Nominatim шукає неіснуючий «Новий».
  const places = [
    ...raw.matchAll(
      /(?:^|,)\s*(?:м|с|смт)\.{1,2}\s*([А-ЯІЇЄҐ][А-ЯІЇЄҐа-яіїєґ'\-]{2,}(?:\s+[А-ЯІЇЄҐ][а-яіїєґ'\-]{2,})?)/gu
    ),
  ];
  const city = places.at(-1)?.[1];

  const kindWord = /вул/i.test(kind)
    ? "вулиця"
    : /просп/i.test(kind)
      ? "проспект"
      : /пл|площ/i.test(kind)
        ? "площа"
        : /пров/i.test(kind)
          ? "провулок"
          : /бульв/i.test(kind)
            ? "бульвар"
            : kind;

  return [`${kindWord} ${cleanName}, ${house}`, city, "Львівська область", "Україна"]
    .filter(Boolean)
    .join(", ");
}

type Row = { id: string; name: string; address: string | null; lat: number; lng: number };

// Клієнти, що сидять у групі 3+ на однакових координатах — це і є
// «геокодер здався і віддав місто».
const rows = await prisma.$queryRaw<Row[]>`
  WITH grp AS (
    SELECT id, name, address, "deliveryLat" AS lat, "deliveryLng" AS lng,
           COUNT(*) OVER (PARTITION BY ROUND("deliveryLat"::numeric,3), ROUND("deliveryLng"::numeric,3)) AS n
    FROM "Counterparty"
    WHERE "geoSource" = 'GEOCODED' AND "deliveryLat" IS NOT NULL
  )
  SELECT id, name, address, lat, lng FROM grp WHERE n > 2 ORDER BY name
`;

console.log(`кандидатів на другу спробу: ${rows.length}`);

let street = 0;
let market = 0;
let city = 0;

for (const r of rows) {
  const raw = r.address ?? "";

  const hit = MARKETS.find((m) => m.match.test(raw));
  if (hit) {
    if (!DRY) {
      await prisma.$executeRaw`
        UPDATE "Counterparty"
        SET "deliveryLat" = ${hit.lat}, "deliveryLng" = ${hit.lng},
            "geoSource" = 'MANUAL', "geoAttemptedAt" = NOW()
        WHERE id = ${r.id}`;
    }
    market += 1;
    console.log(`РИНОК   ${r.name.slice(0, 38).padEnd(39)} → ${hit.label}`);
    continue;
  }

  const cleaned = cleanAddress(raw);
  if (cleaned) {
    const found = await geocodeAddress(cleaned);
    // Приймаємо, лише якщо результат ВІДРІЗНЯЄТЬСЯ від нинішньої міської
    // точки: інакше геокодер знову повернув центр, і ми нічого не виграли.
    const moved =
      found && (Math.abs(found.lat - r.lat) > 3e-4 || Math.abs(found.lng - r.lng) > 3e-4);
    if (found && moved) {
      if (!DRY) {
        await prisma.$executeRaw`
          UPDATE "Counterparty"
          SET "deliveryLat" = ${found.lat}, "deliveryLng" = ${found.lng},
              "geoSource" = 'GEOCODED', "geoAttemptedAt" = NOW()
          WHERE id = ${r.id}`;
      }
      street += 1;
      console.log(`ВУЛИЦЯ  ${r.name.slice(0, 38).padEnd(39)} → ${cleaned.slice(0, 46)}`);
      continue;
    }
  }

  // Нічого кращого немає — чесно позначаємо як міську точку.
  if (!DRY) {
    await prisma.$executeRaw`
      UPDATE "Counterparty" SET "geoSource" = 'CITY', "geoAttemptedAt" = NOW() WHERE id = ${r.id}`;
  }
  city += 1;
}

console.log(
  `\n${DRY ? "ПРОБА: " : ""}знайдено вулицю ${street}, ринок ${market}, лишилось міських ${city}`
);
await prisma.$disconnect();
