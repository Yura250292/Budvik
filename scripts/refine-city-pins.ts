/**
 * Уточнення пінів, що стоять «по місту».
 *
 * 93 клієнти з відвантаженнями мають координати з точністю лише до
 * населеного пункту: пін у центрі Львова, хоча в картці написано «ринок
 * Торпедо, С/12» або «вул. Кульпарівська, 93». Для маршруту це гірше, ніж
 * здається: оптимізатор вважає, що всі вони в одній точці, і будує
 * послідовність об'їзду по фікції.
 *
 * Наявний /api/admin/client-map/geocode такі картки не бере — він шукає
 * тільки тих, у кого координат немає взагалі (`deliveryLat IS NULL`).
 * Звідси цей скрипт.
 *
 * Що робить: для кожного CITY-піна з детальною адресою пробує
 * геокодувати повну адресу. Якщо знайшлася точка, ЯКА ВІДРІЗНЯЄТЬСЯ від
 * поточної більш ніж на 300 м — оновлює і ставить GEOCODED. Якщо
 * геокодер повернув фактично те саме місце, значить точнішого він не знає,
 * і мітка лишається CITY.
 *
 * MANUAL не чіпає ніколи: пін, поставлений рукою, важливіший за будь-що,
 * що поверне геокодер. Те саме правило, що в client-map/geocode.
 *
 * За замовчуванням — режим перегляду, БЕЗ запису в базу:
 *   node --experimental-strip-types scripts/refine-city-pins.ts
 *   node --experimental-strip-types scripts/refine-city-pins.ts --apply
 *   node --experimental-strip-types scripts/refine-city-pins.ts --apply --limit 20
 */

import { PrismaClient } from "@prisma/client";
import { geocodeAddress } from "../src/lib/geo/nominatim.ts";

const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) || 200 : 200;

/**
 * Адреса детальніша за назву міста. Без цього фільтра геокодер отримав би
 * «м. Львів» і повернув той самий центр, витративши секунду на запит.
 */
const HAS_DETAIL =
  /вул|улиц|просп|бульв|пров|буд\b|б-р|ринок|р-?к\b|маг\.|магазин|шосе|дорог|площ|\d+\/\d+|\d+\s*[а-яa-z]?\s*$/i;

/**
 * Наскільки далеко має від'їхати пін, щоб вважати уточнення успішним.
 *
 * 300 метрів: менший зсув у межах міста означає, що геокодер знайшов той
 * самий центр з іншим округленням, а не реальну адресу.
 */
const MIN_SHIFT_M = 300;

/** Відстань між точками по прямій, метри. */
function haversineMeters(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

type Row = {
  id: string;
  name: string;
  address: string;
  /** null — картка ще не має координат узагалі */
  deliveryLat: number | null;
  deliveryLng: number | null;
  docs: number;
};

async function main() {
  console.log(apply ? "РЕЖИМ ЗАПИСУ — база оновлюється\n" : "РЕЖИМ ПЕРЕГЛЯДУ — база не змінюється\n");

  // Тільки ті, кому реально возили: уточнювати пін клієнта без відвантажень
  // немає сенсу, а запит до геокодера коштує секунди.
  // Дві категорії разом: піни «по місту» (є куди рухати) і картки взагалі
  // без координат (клієнта не видно на карті). Обидві виправляються тим
  // самим запитом до геокодера, тож розділяти прогони немає сенсу.
  //
  // MANUAL і FAILED не чіпаємо: перше — рішення адміна, друге вже пробували
  // і воно не далося (для повторів є --retry-failed у client-map/geocode).
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT c.id, c.name, c.address, c."deliveryLat", c."deliveryLng",
           count(d.id)::int AS docs
    FROM "Counterparty" c
    JOIN "SalesDocument" d
      ON d."counterpartyId" = c.id
     AND d."docType" = 'REALIZATION'
     AND d."createdAt" > now() - interval '180 days'
    WHERE c.address IS NOT NULL AND c.address <> ''
      AND (
        (c."geoSource"::text = 'CITY' AND c."deliveryLat" IS NOT NULL)
        OR c."deliveryLat" IS NULL
      )
    GROUP BY c.id, c.name, c.address, c."deliveryLat", c."deliveryLng"
    ORDER BY count(d.id) DESC
    LIMIT ${limit}`;

  const candidates = rows.filter((r) => HAS_DETAIL.test(r.address));
  console.log(
    `Кандидатів: ${candidates.length} (з ${rows.length} CITY-пінів; решта — адреса лише з міста)\n`
  );

  let refined = 0;
  let unchanged = 0;
  let failed = 0;
  let done = 0;

  /**
   * Скільки відмов поспіль означає, що нас притримують.
   *
   * Nominatim не повертає 429 — він просто віддає порожній результат. Тому
   * серія відмов на адресах, які раніше знаходились, читається саме як
   * rate limiting, а не як «таких вулиць немає». Пауза дешевша за прогін,
   * що зіпсував усі результати.
   */
  const COOLDOWN_AFTER = 8;
  const COOLDOWN_MS = 60_000;
  let failStreak = 0;

  for (const r of candidates) {
    done++;
    if (done % 10 === 0) {
      console.log(`  ... ${done}/${candidates.length} (уточнено ${refined})`);
    }

    if (failStreak >= COOLDOWN_AFTER) {
      console.log(`  ⏸  ${failStreak} відмов поспіль — пауза 60 с (ліміт Nominatim)`);
      await new Promise((res) => setTimeout(res, COOLDOWN_MS));
      failStreak = 0;
    }

    const hit = await geocodeAddress(r.address);

    if (!hit) {
      failed++;
      failStreak++;
      console.log(`  —  ${r.name}`);
      console.log(`     ${r.address}`);
      continue;
    }
    failStreak = 0;

    // Порожні координати приймаємо будь-які: рухати нема від чого, і точка
    // навіть із похибкою краща за відсутність клієнта на карті.
    const lat = r.deliveryLat;
    const lng = r.deliveryLng;
    const isNew = lat == null || lng == null;
    const shift = isNew ? Infinity : haversineMeters(lat, lng, hit.lat, hit.lng);

    if (shift < MIN_SHIFT_M) {
      unchanged++;
      continue;
    }

    refined++;
    console.log(`  ✓  ${r.name}  (${r.docs} накл.)`);
    console.log(`     ${r.address}`);
    console.log(
      isNew
        ? `     НОВА точка → ${hit.displayName}`
        : `     пін їде на ${Math.round(shift)} м → ${hit.displayName}`
    );

    if (apply) {
      await prisma.$executeRaw`
        UPDATE "Counterparty"
        SET "deliveryLat" = ${hit.lat}, "deliveryLng" = ${hit.lng},
            "geoSource" = 'GEOCODED', "geoAttemptedAt" = NOW()
        WHERE id = ${r.id}`;
    }
  }

  console.log(`\nПІДСУМОК`);
  console.log(`  уточнено:        ${refined}`);
  console.log(`  без змін:        ${unchanged}  (геокодер дав те саме місце)`);
  console.log(`  не знайдено:     ${failed}`);
  if (!apply && refined > 0) {
    console.log(`\n  Записати в базу: додайте --apply`);
  }
  console.log();

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
