-- Кеш АІ-інсайтів по торговому та по команді.
--
-- Інсайти генеруються за кнопкою й коштують токенів, тож перегенерувати
-- їх на кожен перехід між вкладками не можна. Ключ — (вид, торговий,
-- межі періоду): той самий період віддає той самий висновок, поки
-- керівник свідомо не натисне «оновити».
--
-- facts зберігається поруч з insights навмисно: картка показує числа з
-- нашого зведення, а не зі слів моделі, і без збереженого зведення
-- довелося б перераховувати весь SQL заради відображення кешу.
--
-- IF NOT EXISTS — як у попередніх міграціях: об'єкти могли з'явитися
-- вручну на проді, і повторний прогін не має валити деплой.

CREATE TABLE IF NOT EXISTS "AiInsightReport" (
    "id"        TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "repId"     TEXT,
    "fromDay"   TEXT NOT NULL,
    "toDay"     TEXT NOT NULL,
    "insights"  JSONB NOT NULL,
    "facts"     JSONB NOT NULL,
    "model"     TEXT NOT NULL,
    "tokens"    INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInsightReport_pkey" PRIMARY KEY ("id")
);

-- Унікальність по вікну: повторна генерація за той самий період оновлює
-- наявний рядок, а не плодить копії. repId порожній у командного звіту,
-- тому в Postgres два командні звіти за різні періоди не конфліктують.
CREATE UNIQUE INDEX IF NOT EXISTS "AiInsightReport_kind_repId_fromDay_toDay_key"
    ON "AiInsightReport" ("kind", "repId", "fromDay", "toDay");

CREATE INDEX IF NOT EXISTS "AiInsightReport_createdAt_idx"
    ON "AiInsightReport" ("createdAt");

-- Звіт живе рівно стільки, скільки торговий: видалили людину — старі
-- висновки про неї не мають лишатися.
DO $$ BEGIN
    ALTER TABLE "AiInsightReport"
        ADD CONSTRAINT "AiInsightReport_repId_fkey"
        FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
