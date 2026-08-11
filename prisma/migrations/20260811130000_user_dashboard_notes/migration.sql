-- Особисті нотатки-задачі з віджета дашборду.
--
-- Рядками, а не одним JSON-полем поруч із розкладкою: нотатку треба вміти
-- позначити зробленою й видалити окремо, не переписуючи весь блок — інакше
-- дві вкладки, відкриті одночасно, затирали б правки одна одної.
--
-- IF NOT EXISTS — як і в попередніх міграціях: об'єкти могли з'явитися
-- вручну на проді, повторний прогін не має валити деплой.

CREATE TABLE IF NOT EXISTS "UserDashboardNote" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "text"      TEXT NOT NULL,
    "done"      BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDashboardNote_pkey" PRIMARY KEY ("id")
);

-- Віджет завжди читає нотатки одного користувача, невиконані й свіжі згори.
CREATE INDEX IF NOT EXISTS "UserDashboardNote_userId_done_createdAt_idx"
    ON "UserDashboardNote"("userId", "done", "createdAt");

-- ON DELETE CASCADE: нотатки не мають сенсу без користувача.
DO $$ BEGIN
    ALTER TABLE "UserDashboardNote"
        ADD CONSTRAINT "UserDashboardNote_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
