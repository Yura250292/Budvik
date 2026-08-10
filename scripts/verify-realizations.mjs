/**
 * Перевірка переходу аналітики торгових на реалізації.
 * Лише читання: жодних INSERT/UPDATE/DDL.
 *
 * Запуск: node --env-file=.env scripts/verify-realizations.mjs
 *
 * Що показує:
 *  1) чи накотилася міграція docType (enum, колонка, індекси);
 *  2) скільки замовлень і реалізацій лежить у базі по місяцях — саме ці суми
 *     звіряються з журналом «Реализация товаров и услуг» у 1С;
 *  3) чи зіставилися торгові (реалізація без salesRepId випадає з аналітики);
 *  4) чи справді номери документів збігаються між типами — заради цього
 *     унікальність переїхала з (number) на (number, docType).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SINCE = new Date("2026-01-01T00:00:00Z");
const money = (n) => Number(n ?? 0).toLocaleString("uk-UA", { maximumFractionDigits: 0 });

// --- 1. Схема ---------------------------------------------------------------

const enumVals = await prisma.$queryRaw`
  SELECT e.enumlabel AS label
  FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE t.typname = 'SalesDocType'
  ORDER BY e.enumsortorder`;
console.log(`enum SalesDocType: ${enumVals.map((e) => e.label).join(", ") || "⚠️ НЕМАЄ"}`);

const col = await prisma.$queryRaw`
  SELECT data_type, udt_name, column_default, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'SalesDocument' AND column_name = 'docType'`;
console.log(
  col.length
    ? `SalesDocument.docType: ${col[0].udt_name}, default=${col[0].column_default}, nullable=${col[0].is_nullable}`
    : "⚠️ SalesDocument.docType ВІДСУТНЯ"
);

const idx = await prisma.$queryRaw`
  SELECT indexname FROM pg_indexes
  WHERE tablename = 'SalesDocument'
    AND (indexname LIKE '%number%' OR indexname LIKE '%docType%')
  ORDER BY indexname`;
console.log(`\nІндекси SalesDocument (${idx.length}):`);
for (const i of idx) console.log(`  ${i.indexname}`);

// Старий унікальний індекс по одному номеру мусить зникнути: інакше реалізація
// з тим самим номером, що й замовлення, не вставиться.
const stale = idx.some((i) => i.indexname === "SalesDocument_number_key");
console.log(stale
  ? "  ⚠️ SalesDocument_number_key ЩЕ ІСНУЄ — міграція не доїхала"
  : "  ✓ старий SalesDocument_number_key знято");

// --- 2. Документи по місяцях ------------------------------------------------

const byMonth = await prisma.$queryRaw`
  SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month,
         "docType"::text AS doc_type,
         COUNT(*)::int AS docs,
         SUM("totalAmount")::float AS amount
  FROM "SalesDocument"
  WHERE "externalId" IS NOT NULL AND status = 'CONFIRMED' AND "createdAt" >= ${SINCE}
  GROUP BY 1, 2
  ORDER BY 1, 2`;

console.log(`\nПроведені документи з 1С із ${SINCE.toISOString().slice(0, 10)}:`);
console.log(`  ${"місяць".padEnd(9)}${"тип".padEnd(13)}${"шт".padStart(7)}${"сума".padStart(15)}`);
for (const r of byMonth) {
  console.log(`  ${r.month.padEnd(9)}${r.doc_type.padEnd(13)}${String(r.docs).padStart(7)}${money(r.amount).padStart(15)}`);
}
if (!byMonth.some((r) => r.doc_type === "REALIZATION")) {
  console.log("  ⚠️ реалізацій НЕМАЄ — агент їх ще не прислав, аналітику перемикати рано");
}

// --- 3. Зіставлення торгових ------------------------------------------------

const reps = await prisma.$queryRaw`
  SELECT "docType"::text AS doc_type,
         COUNT(*) FILTER (WHERE "salesRepId" IS NULL)::int AS no_rep,
         COUNT(*)::int AS total
  FROM "SalesDocument"
  WHERE "externalId" IS NOT NULL AND status = 'CONFIRMED' AND "createdAt" >= ${SINCE}
  GROUP BY 1 ORDER BY 1`;
console.log(`\nБез зіставленого торгового (такі документи не потраплять у КПІ):`);
for (const r of reps) {
  const pct = r.total ? ((r.no_rep / r.total) * 100).toFixed(1) : "0.0";
  console.log(`  ${r.doc_type.padEnd(13)}${r.no_rep}/${r.total} (${pct}%)`);
}

// --- 4. Збіги номерів між типами -------------------------------------------

const dupes = await prisma.$queryRaw`
  SELECT number, COUNT(DISTINCT "docType")::int AS types
  FROM "SalesDocument"
  GROUP BY number HAVING COUNT(DISTINCT "docType") > 1
  ORDER BY number LIMIT 10`;
console.log(`\nНомери, що збігаються між замовленням і реалізацією: ${dupes.length}${dupes.length === 10 ? "+" : ""}`);
for (const d of dupes) console.log(`  ${d.number}`);
if (dupes.length) {
  console.log("  (саме тому унікальність тепер по парі (number, docType))");
}

// --- 5. Читання через Prisma Client ----------------------------------------

const realizations = await prisma.salesDocument.count({ where: { docType: "REALIZATION" } });
const orders = await prisma.salesDocument.count({ where: { docType: "ORDER" } });
console.log(`\nЧитання через Prisma Client:`);
console.log(`  ORDER: ${orders} рядків, REALIZATION: ${realizations} рядків ✓`);

await prisma.$disconnect();
