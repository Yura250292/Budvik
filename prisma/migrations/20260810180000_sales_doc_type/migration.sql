-- Тип документа продажу: замовлення покупця чи реалізація товарів.
--
-- До цієї міграції в SalesDocument лежали ТІЛЬКИ замовлення (агент 1С читав
-- Документ.ЗаказПокупателя), хоча аналітика торгових мала показувати
-- реалізації — фактично відвантажене. Тепер обидва типи живуть поруч:
-- аналітика рахує REALIZATION, ERP далі працює з ORDER, а різниця між ними
-- дає недовози.
--
-- IF NOT EXISTS — та сама причина, що й у попередніх міграціях: об'єкти
-- могли з'явитися вручну на проді, і повторний прогін не має валити деплой.

DO $$ BEGIN
    CREATE TYPE "SalesDocType" AS ENUM ('ORDER', 'REALIZATION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- DEFAULT 'ORDER' закриває і наявні рядки, і документи, створені на сайті:
-- усе, що вже лежить у таблиці, — це замовлення.
ALTER TABLE "SalesDocument"
    ADD COLUMN IF NOT EXISTS "docType" "SalesDocType" NOT NULL DEFAULT 'ORDER';

-- Унікальність номера переїжджає з (number) на (number, docType).
--
-- 1С нумерує ЗаказПокупателя і РеализацияТоваровУслуг незалежними
-- лічильниками, тож номер "00000012345" цілком може прийти двічі — раз як
-- замовлення, раз як реалізація. Зі старим унікальним індексом друга вставка
-- падала б, і реалізація просто не долітала б у базу.
ALTER TABLE "SalesDocument" DROP CONSTRAINT IF EXISTS "SalesDocument_number_key";
DROP INDEX IF EXISTS "SalesDocument_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "SalesDocument_number_docType_key"
    ON "SalesDocument"("number", "docType");

-- Під головний запит аналітики торгових: реалізації, проведені, за період.
CREATE INDEX IF NOT EXISTS "SalesDocument_docType_status_createdAt_idx"
    ON "SalesDocument"("docType", "status", "createdAt");
