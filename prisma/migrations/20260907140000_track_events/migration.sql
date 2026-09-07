-- Чорна скринька треку: послідовність подій на пристрої.
--
-- Пульс каже, ЯК ЗАРАЗ. 07.09 цього виявилося мало: чотири планшети
-- показували бездоганний стан і нуль точок за чотири години, а з якої миті
-- й після якої події все стало — не було видно ніде.
CREATE TABLE "TrackEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "note" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackEvent_pkey" PRIMARY KEY ("id")
);

-- Пульс може повторитися — журнал від цього подвоюватися не має.
CREATE UNIQUE INDEX "TrackEvent_userId_at_kind_key" ON "TrackEvent"("userId", "at", "kind");
CREATE INDEX "TrackEvent_userId_at_idx" ON "TrackEvent"("userId", "at");

ALTER TABLE "TrackEvent" ADD CONSTRAINT "TrackEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Життя контексту JS: без цих чисел мертву службу не відрізнити від
-- мовчазного приймача — прапорець `tracking` в обох випадках однаковий.
ALTER TABLE "DeviceHeartbeat" ADD COLUMN "contextStartedAt" TIMESTAMP(3);
ALTER TABLE "DeviceHeartbeat" ADD COLUMN "fixBatches" INTEGER;
ALTER TABLE "DeviceHeartbeat" ADD COLUMN "contextPoints" INTEGER;
