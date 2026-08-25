/**
 * Разовий бекфіл координат клієнтів для карти.
 *
 * Та сама логіка, що в POST /api/admin/client-map/geocode, але без
 * дедлайну Vercel: у терміналі можна пройти всі адреси за один раз.
 * Ендпоінт лишається для довантаження нових клієнтів з інтерфейсу.
 */
import { PrismaClient } from "@prisma/client";
import { geocodeAddress } from "../src/lib/geo/nominatim";

const prisma = new PrismaClient();
const HOME_REGION = "Львівська область";

function settlementFromName(name: string): string | null {
  const inside = name.match(/\(([^)]*)\)/)?.[1]?.trim();
  if (!inside) return null;
  const prefixed = inside.match(/(?:^|\s)(?:м|с|смт)\.?\s*([А-ЯЇІЄҐA-Z][^,;]*)/iu)?.[1]?.trim();
  const candidate =
    prefixed ?? (!/\d/.test(inside) && !inside.includes(",") && inside.split(/\s+/).length === 1 ? inside : null);
  if (!candidate || candidate.length < 3) return null;
  return `${candidate}, ${HOME_REGION}, Україна`;
}

/**
 * За замовчуванням беремо лише клієнтів, які комусь належать або щось
 * купували: геокодер повільний (Nominatim просить секунду на запит), і
 * витрачати години на картки, яких ніхто не побачить, сенсу немає.
 *
 * Але саме цей фільтр і був причиною, чому координати мали 375 карток із
 * 3689: адреса є в 3245, а під умову підпадали сотні. Тому є `--all` —
 * пройти всіх активних із адресою.
 */
const all = process.argv.includes("--all");
const audience = all
  ? ""
  : `AND (EXISTS (SELECT 1 FROM "SalesRepClient" src WHERE src."counterpartyId" = c.id)
      OR EXISTS (SELECT 1 FROM "SalesDocument" s WHERE s."counterpartyId" = c.id
         AND s."externalId" IS NOT NULL AND s.status='CONFIRMED' AND s."docType"='REALIZATION'))`;

const rows: Array<{ id: string; name: string; address: string }> = await prisma.$queryRawUnsafe(`
  SELECT c.id, c.name, c.address FROM "Counterparty" c
  WHERE c."isActive" AND COALESCE(c.address,'') <> ''
    AND c."deliveryLat" IS NULL AND c."geoAttemptedAt" IS NULL
    ${audience}
  ORDER BY c.name`);

console.log(all ? "режим: усі активні з адресою" : "режим: лише клієнти з торговим або продажем");

console.log(`до геокодування: ${rows.length}`);
let ok = 0, viaCity = 0, miss = 0, i = 0;

for (const row of rows) {
  i++;
  let hit = await geocodeAddress(row.address);
  let how = "адреса";
  if (!hit) {
    const fallback = settlementFromName(row.name);
    if (fallback) { hit = await geocodeAddress(fallback); how = "місто"; }
  }
  // Пишемо сирим SQL, а не через ORM: клієнт Prisma згенерований зі схеми,
  // де вже є колонки сусідньої, ще не застосованої міграції, тож
  // counterparty.update() падає на неіснуючому стовпці. Нас цікавлять лише
  // чотири власні поля — їх і оновлюємо.
  if (hit) {
    how === "адреса" ? ok++ : viaCity++;
    await prisma.$executeRaw`
      UPDATE "Counterparty"
      SET "deliveryLat" = ${hit.lat}, "deliveryLng" = ${hit.lng},
          "geoSource" = 'GEOCODED', "geoAttemptedAt" = NOW()
      WHERE id = ${row.id}`;
  } else {
    miss++;
    await prisma.$executeRaw`
      UPDATE "Counterparty"
      SET "geoSource" = 'FAILED', "geoAttemptedAt" = NOW()
      WHERE id = ${row.id}`;
  }
  if (i % 25 === 0 || i === rows.length) {
    console.log(`[${i}/${rows.length}] адресою ${ok} · містом ${viaCity} · не знайдено ${miss}`);
  }
}
console.log(`ГОТОВО: адресою ${ok}, містом ${viaCity}, не знайдено ${miss}`);
await prisma.$disconnect();
