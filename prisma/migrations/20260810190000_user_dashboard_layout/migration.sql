-- Розкладка віджетів дашборду адмінки, персонально для кожного користувача.
--
-- Окрема таблиця, а не колонка в User: розкладку треба вміти скинути одним
-- DELETE, не чіпаючи гарячу таблицю користувачів, яку пише авторизація.
--
-- IF NOT EXISTS — як і в попередніх міграціях: об'єкти могли з'явитися
-- вручну на проді, повторний прогін не має валити деплой.

CREATE TABLE IF NOT EXISTS "UserDashboardLayout" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    -- { version: 1, widgets: [{ id, type, size, order }] }
    "layout"    JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDashboardLayout_pkey" PRIMARY KEY ("id")
);

-- Один рядок на користувача: upsert по userId — єдиний спосіб запису.
CREATE UNIQUE INDEX IF NOT EXISTS "UserDashboardLayout_userId_key"
    ON "UserDashboardLayout"("userId");

-- ON DELETE CASCADE: розкладка не має сенсу без користувача.
DO $$ BEGIN
    ALTER TABLE "UserDashboardLayout"
        ADD CONSTRAINT "UserDashboardLayout_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
