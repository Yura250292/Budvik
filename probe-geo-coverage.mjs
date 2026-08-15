/** Покриття клієнтів координатами — стан на сьогодні. Лише читання. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const [tot] = await prisma.$queryRaw`
  SELECT count(*)::int AS all_cp,
         count(*) FILTER (WHERE "deliveryLat" IS NOT NULL)::int AS geo,
         count(*) FILTER (WHERE "deliveryAddress" IS NOT NULL AND "deliveryAddress" <> '')::int AS addr,
         count(*) FILTER (WHERE "isActive")::int AS active
  FROM "Counterparty"`;
console.log(`Контрагентів: ${tot.all_cp} (активних ${tot.active})`);
console.log(`  з адресою доставки: ${tot.addr}`);
console.log(`  з координатами:     ${tot.geo}`);

// Чи є поле geoSource (додала паралельна сесія)
const cols = await prisma.$queryRaw`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='Counterparty' AND column_name IN ('geoSource','deliveryZone')`;
console.log(`  нові колонки: ${cols.map(c=>c.column_name).join(", ") || "немає"}`);

if (cols.some(c => c.column_name === 'geoSource')) {
  const src = await prisma.$queryRaw`
    SELECT COALESCE("geoSource",'(null)') AS src, count(*)::int AS n
    FROM "Counterparty" WHERE "deliveryLat" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`;
  console.log("\nТочність координат:");
  for (const s of src) console.log(`  ${s.src.padEnd(10)} ${s.n}`);
}

// Скільки клієнтів реально возять — ті, у кого є реалізації
const [ship] = await prisma.$queryRaw`
  SELECT count(DISTINCT c.id)::int AS shipped,
         count(DISTINCT c.id) FILTER (WHERE c."deliveryLat" IS NOT NULL)::int AS shipped_geo
  FROM "Counterparty" c
  JOIN "SalesDocument" d ON d."counterpartyId" = c.id
  WHERE d."docType" = 'REALIZATION' AND d."createdAt" > now() - interval '90 days'`;
console.log(`\nКлієнтів з відвантаженнями за 90 днів: ${ship.shipped}`);
console.log(`  з них мають координати: ${ship.shipped_geo} (${Math.round(ship.shipped_geo/Math.max(1,ship.shipped)*100)}%)`);
console.log(`  БЕЗ координат: ${ship.shipped - ship.shipped_geo} — саме вони ламають маршрут`);

await prisma.$disconnect();
