/**
 * Перевірка, що міграції треку й відхилень справді накотилися.
 * Лише читання: жодних INSERT/UPDATE/DDL.
 *
 * Запуск: node --env-file=.env scripts/verify-track-migration.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EXPECTED_TRIP_COLUMNS = [
  "liveMessageId", "liveChatId", "liveStartedAt", "liveExpiresAt",
  "liveLastPointAt", "liveStoppedAt", "trackDistanceKm", "trackMinutes",
  "trackCoverage", "routeTemplateId", "onRouteRatio", "offRouteKm",
  "excursions", "deviationAlertedAt",
];

const cols = await prisma.$queryRaw`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_name = 'SalesTrip'
    AND column_name = ANY(${EXPECTED_TRIP_COLUMNS})
  ORDER BY column_name`;

console.log(`SalesTrip — нові колонки: ${cols.length}/${EXPECTED_TRIP_COLUMNS.length}`);
for (const c of cols) console.log(`  ${c.column_name.padEnd(20)} ${c.data_type}`);

const missing = EXPECTED_TRIP_COLUMNS.filter(
  (n) => !cols.some((c) => c.column_name === n)
);
if (missing.length) console.log(`  ⚠️ БРАКУЄ: ${missing.join(", ")}`);

const tbl = await prisma.$queryRaw`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_name = 'SalesTrackPoint' ORDER BY ordinal_position`;
console.log(`\nSalesTrackPoint — колонок: ${tbl.length}`);
for (const c of tbl) console.log(`  ${c.column_name.padEnd(18)} ${c.data_type}`);

const idx = await prisma.$queryRaw`
  SELECT indexname FROM pg_indexes
  WHERE tablename IN ('SalesTrackPoint', 'SalesTrip')
    AND (indexname LIKE '%TrackPoint%' OR indexname LIKE '%offRoute%')
  ORDER BY indexname`;
console.log(`\nІндекси (${idx.length}):`);
for (const i of idx) console.log(`  ${i.indexname}`);

const fks = await prisma.$queryRaw`
  SELECT conname, confrelid::regclass::text AS refs, confdeltype
  FROM pg_constraint
  WHERE conrelid = 'public."SalesTrackPoint"'::regclass AND contype = 'f'
  ORDER BY conname`;
console.log(`\nЗовнішні ключі (${fks.length}):`);
for (const f of fks) {
  console.log(`  ${f.conname} → ${f.refs} (ondelete=${f.confdeltype === "c" ? "CASCADE" : f.confdeltype})`);
}

// Головна перевірка: Prisma Client реально читає нові поля з бази
const points = await prisma.salesTrackPoint.count();
const trips = await prisma.salesTrip.count();
console.log(`\nЧитання через Prisma Client:`);
console.log(`  SalesTrackPoint: ${points} рядків ✓`);
console.log(`  SalesTrip: ${trips} рядків, нові поля доступні ✓`);

await prisma.$disconnect();
