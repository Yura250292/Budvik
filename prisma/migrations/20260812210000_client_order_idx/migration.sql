-- Індекси під картку «Останнє замовлення + рекомендації» на карті клієнтів.
--
-- CONCURRENTLY з тієї ж причини, що й у 20260811180000_perf_indexes: звичайний
-- CREATE INDEX узяв би ACCESS EXCLUSIVE і поклав би обмін із 1С на час
-- побудови.
--
-- УВАГА, ГРАБЛІ: `prisma migrate deploy` на цьому файлі падає з
-- "CREATE INDEX CONCURRENTLY cannot run inside a transaction block" (код
-- 25001). Prisma загортає міграцію з КІЛЬКОХ стейтментів у транзакцію —
-- сусідній perf_indexes проходить лише тому, що там перед індексами стоїть
-- CREATE EXTENSION, який змушує Prisma піти іншим шляхом. Розраховувати на це
-- не можна. Тому індекси створюються вручну, а міграція позначається як
-- застосована:
--
--   node -e 'const{PrismaClient}=require("@prisma/client");const p=new PrismaClient();
--     (async()=>{for(const s of require("fs").readFileSync(
--       "prisma/migrations/20260812210000_client_order_idx/migration.sql","utf8")
--       .split(";").map(x=>x.trim()).filter(x=>x&&!x.startsWith("--")))
--       await p.$executeRawUnsafe(s);await p.$disconnect()})()'
--   npx prisma migrate resolve --applied 20260812210000_client_order_idx
--
-- Якщо створення впаде посередині — індекс лишиться INVALID (запити працюють,
-- планувальник його просто не бачить). Знайти й перестворити:
--   SELECT i.indexrelid::regclass FROM pg_index i WHERE NOT i.indisvalid;

-- Заміряно на бойових даних: ДО індексів вибірка останніх документів ішла
-- Seq Scan-ом по "SalesDocument" (10 394 рядки) — 1.3 с. ПІСЛЯ, на
-- найактивнішому клієнті (264 документи): Index Scan, 0.29 мс.
--
-- Умова WHERE тут дослівно повторює SOURCE_FILTER із src/lib/analytics/facts.ts.
-- Саме дослівно: планувальник застосує частковий індекс лише тоді, коли зможе
-- довести, що предикат запиту імплікує предикат індексу, а робить він це
-- зіставленням виразів. Будь-яке переформулювання (інший порядок умов теж
-- ризиковано) — і індекс мовчки перестане використовуватися.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SalesDocument_client_recent_idx"
  ON "SalesDocument" ("counterpartyId", "createdAt" DESC)
  WHERE "externalId" IS NOT NULL
    AND status = 'CONFIRMED'
    AND "docType" IN ('REALIZATION', 'RETURN');

-- 27 843 рядки без жодного індексу, крім PK. Кожен json_agg позицій документа
-- був повним скануванням таблиці, а картка робить це для п'яти документів.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SalesDocumentItem_salesDocumentId_idx"
  ON "SalesDocumentItem" ("salesDocumentId");

-- Обхід у зворотний бік — «товар -> хто його брав», основа рекомендацій
-- «беруть схожі клієнти».
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SalesDocumentItem_productId_idx"
  ON "SalesDocumentItem" ("productId");
