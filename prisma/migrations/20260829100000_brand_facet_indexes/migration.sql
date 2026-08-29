-- Індекси під фасети «розділи й групи в межах бренда».
--
-- Панель фільтрів тепер рахує числа розділів і груп тим самим where, що й
-- видача: обраний бренд лишається в умові, тож кожен фасет — це groupBy по
-- (brandId, sectionId) або (brandId, typeKey). Наявний Product_brandId_idx
-- відбирає бренд, але далі йде фільтрація 40 тис. рядків по другій колонці.
--
-- ВАЖЛИВО: CONCURRENTLY, бо Product — 69 МБ / 49 тис. рядків, і звичайний
-- CREATE INDEX узяв би ACCESS EXCLUSIVE, тобто поклав би каталог на час
-- побудови. CONCURRENTLY не можна виконувати всередині транзакції, тому в
-- цьому файлі НЕ повинно з'явитися BEGIN/COMMIT — Prisma виконує міграції по
-- одному стейтменту, і саме на це тут розрахунок.
--
-- `prisma migrate deploy` усе одно завертає файл у транзакцію і падає з 25001,
-- тому цю міграцію застосовують вручну через psql, а потім позначають:
--   npx prisma migrate resolve --applied 20260829100000_brand_facet_indexes
-- Якщо створення впало посередині — індекс лишається INVALID, знайти його:
--   SELECT i.indexrelid::regclass FROM pg_index i WHERE NOT i.indisvalid;
--
-- Часткові (WHERE "isActive"), бо фасети ніколи не рахують неактивні картки;
-- у schema.prisma їх немає навмисно — @@index не вміє partial (той самий
-- прийом, що в 20260811180000_perf_indexes).

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_brand_section_idx"
  ON "Product" ("brandId", "sectionId")
  WHERE "isActive";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Product_brand_type_idx"
  ON "Product" ("brandId", "typeKey")
  WHERE "isActive";
