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
import { cleanAddress } from "../src/lib/geo/clean-address";
import { LVIV_MARKETS } from "../src/lib/geo/markets";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry");

const MARKETS = LVIV_MARKETS;

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

  const cleaned = cleanAddress(raw, { lviv: true });
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
