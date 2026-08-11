-- Архів АІ-звітів: те, що керівник відклав навмисно.
--
-- Окрема таблиця, а не прапорець на AiInsightReport, бо в них різне життя.
-- Кеш — «останній звіт за цей період», його перезаписує кожна наступна
-- генерація. Архів — знімок на момент збереження: той самий період можна
-- відкласти двічі з різницею в місяць і порівняти, що змінилося.
--
-- insights і facts зберігаються копіями, а не посиланням на кеш: сенс архіву
-- в тому, що він не змінюється, коли цифри в базі поїхали далі.
--
-- IF NOT EXISTS — як у попередніх міграціях: об'єкти могли з'явитися вручну
-- на проді, і повторний прогін не має валити деплой.

CREATE TABLE IF NOT EXISTS "SavedAiReport" (
    "id"        TEXT NOT NULL,
    "kind"      TEXT NOT NULL,
    "repId"     TEXT,
    "fromDay"   TEXT NOT NULL,
    "toDay"     TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "note"      TEXT,
    "insights"  JSONB NOT NULL,
    "facts"     JSONB NOT NULL,
    "model"     TEXT NOT NULL,
    "tokens"    INTEGER NOT NULL DEFAULT 0,
    "savedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedAiReport_pkey" PRIMARY KEY ("id")
);

-- Унікальності немає навмисно: той самий період можна зберегти кілька разів
-- у різні дні — саме заради порівняння «було / стало».
CREATE INDEX IF NOT EXISTS "SavedAiReport_kind_repId_createdAt_idx"
    ON "SavedAiReport" ("kind", "repId", "createdAt");

CREATE INDEX IF NOT EXISTS "SavedAiReport_createdAt_idx"
    ON "SavedAiReport" ("createdAt");

-- Видалили торгового — його архів іде за ним.
DO $$ BEGIN
    ALTER TABLE "SavedAiReport"
        ADD CONSTRAINT "SavedAiReport_repId_fkey"
        FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Автор — RESTRICT: звіт має пам'ятати, хто його відклав, тож користувача з
-- архівом не можна видалити мовчки.
DO $$ BEGIN
    ALTER TABLE "SavedAiReport"
        ADD CONSTRAINT "SavedAiReport_savedById_fkey"
        FOREIGN KEY ("savedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
