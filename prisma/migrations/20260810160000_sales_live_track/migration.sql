-- Фоновий трек торгового: жива локація Telegram.
--
-- IF NOT EXISTS усюди: та сама причина, що й у попередніх міграціях —
-- колонки могли з'явитися вручну на проді, і повторний прогін не має
-- валити деплой.

-- AlterTable: стан трансляції на поїздці
ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "liveMessageId" INTEGER;
ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "liveChatId" TEXT;
ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "liveStartedAt" TIMESTAMP(3);
ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "liveExpiresAt" TIMESTAMP(3);
ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "liveLastPointAt" TIMESTAMP(3);
ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "liveStoppedAt" TIMESTAMP(3);
ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "trackDistanceKm" INTEGER;
ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "trackMinutes" INTEGER;
ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "trackCoverage" DOUBLE PRECISION;

-- CreateTable: точки треку
CREATE TABLE IF NOT EXISTS "SalesTrackPoint" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" INTEGER,
    "headingDeg" INTEGER,
    "speedKmh" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "metersFromPrev" INTEGER,
    "minutesFromPrev" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesTrackPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Обидва індекси — під два єдиних сценарії читання: «трек однієї поїздки»
-- (карта дня) і «трек торгового за період» (звірка з документами).
CREATE INDEX IF NOT EXISTS "SalesTrackPoint_tripId_recordedAt_idx"
    ON "SalesTrackPoint"("tripId", "recordedAt");
CREATE INDEX IF NOT EXISTS "SalesTrackPoint_userId_recordedAt_idx"
    ON "SalesTrackPoint"("userId", "recordedAt");

-- AddForeignKey
-- ON DELETE CASCADE: точки не мають сенсу без поїздки, і видалення
-- користувача не повинно впиратися в сотні тисяч рядків треку.
DO $$
BEGIN
    ALTER TABLE "SalesTrackPoint" ADD CONSTRAINT "SalesTrackPoint_tripId_fkey"
        FOREIGN KEY ("tripId") REFERENCES "SalesTrip"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "SalesTrackPoint" ADD CONSTRAINT "SalesTrackPoint_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
