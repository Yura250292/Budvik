/**
 * Стан бойової бази: версія, розмір, найбільші таблиці, активні конекшени.
 * Лише читання — жодних змін.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const [{ version }] = await prisma.$queryRaw`SELECT version()`;
console.log("Postgres:", version.split(",")[0]);

const [{ size }] = await prisma.$queryRaw`
  SELECT pg_size_pretty(pg_database_size(current_database())) AS size`;
console.log("Розмір бази:", size);

const conns = await prisma.$queryRaw`
  SELECT state, count(*)::int AS n FROM pg_stat_activity
  WHERE datname = current_database() GROUP BY state ORDER BY n DESC`;
console.log("\nКонекшени:");
for (const c of conns) console.log(`  ${(c.state ?? "—").padEnd(22)} ${c.n}`);

const tables = await prisma.$queryRaw`
  SELECT relname AS t, n_live_tup::int AS rows,
         pg_size_pretty(pg_total_relation_size(relid)) AS size
  FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 8`;
console.log("\nНайбільші таблиці:");
for (const t of tables) console.log(`  ${t.t.padEnd(24)} ${String(t.rows).padStart(8)} рядків  ${t.size}`);

// Наскільки близько до вичерпання місця на томі (50 ГБ)
const [{ bytes }] = await prisma.$queryRaw`
  SELECT pg_database_size(current_database())::bigint AS bytes`;
const gb = Number(bytes) / 1024 ** 3;
console.log(`\nЗайнято: ${gb.toFixed(2)} ГБ із 50 ГБ тому (${((gb / 50) * 100).toFixed(1)}%)`);

await prisma.$disconnect();
