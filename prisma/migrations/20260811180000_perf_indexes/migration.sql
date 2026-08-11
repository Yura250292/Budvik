-- Індекси під гарячі шляхи каталогу й закриття обміну з 1С.
--
-- ВАЖЛИВО: усі індекси створюються CONCURRENTLY, бо Product — 69 МБ / 49 тис.
-- рядків, і звичайний CREATE INDEX узяв би ACCESS EXCLUSIVE, тобто поклав би
-- каталог на час побудови. CONCURRENTLY не можна виконувати всередині
-- транзакції, тому в цьому файлі НЕ повинно з'явитися BEGIN/COMMIT — Prisma
-- виконує міграції по одному стейтменту, і саме на це тут розрахунок.
--
-- Якщо міграція впаде посередині, Postgres лишить індекс у стані INVALID.
-- Це не ламає запити (планувальник його просто не використовує), але такий
-- індекс треба знайти й перестворити:
--   SELECT i.indexrelid::regclass FROM pg_index i WHERE NOT i.indisvalid;

-- Заміряно на копії бойових даних (48 961 рядок):
--   сорт каталогу за замовчуванням: 18.2 мс -> 0.22 мс
-- Частковий (WHERE "isActive"), бо каталог ніколи не сортує неактивні.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_catalog_sort_idx"
  ON "Product" (priority DESC, stock DESC, name ASC)
  WHERE "isActive";

-- Під фільтр за категорією (JOIN Category + isActive).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_active_category_idx"
  ON "Product" ("categoryId")
  WHERE "isActive";

-- Пошук по назві — ILIKE '%слово%', який btree не покриває в принципі.
-- Заміряно: count по пошуку 110.6 мс -> 1.85 мс, вибірка 4.7 мс -> 0.24 мс.
-- Багатослівний пошук виконує такий запит по разу на слово, тож ефект
-- множиться. Розмір індексу ~8.6 МБ.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_name_trgm_idx"
  ON "Product" USING gin (name gin_trgm_ops);

-- 113 тис. рядків / 58 МБ без жодного індексу, крім PK. Закриття прогону
-- обміну робить три count по syncJobId поспіль — кожен був повним скануванням
-- 58 МБ, що вимивало каталог із 128 МБ shared_buffers.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SyncDiscrepancy_syncJobId_field_idx"
  ON "SyncDiscrepancy" ("syncJobId", "field");
