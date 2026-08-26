-- Пульс планшета: застосунок звітує про себе навіть тоді, коли точок немає.
--
-- Писалося руками, а не `migrate diff`: той разом із новою таблицею
-- зносив Product_name_trgm_idx (трграмний індекс пошуку, створений
-- вручну через CONCURRENTLY) і перетрушував зовнішні ключі Order і
-- DeliveryStop. Тут — рівно те, що потрібно.

CREATE TABLE "DeviceHeartbeat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT,
    "deviceName" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedAt" TIMESTAMP(3),
    "tracking" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT,
    "shiftOpen" BOOLEAN NOT NULL DEFAULT false,
    "buffered" INTEGER NOT NULL DEFAULT 0,
    "lastFixAt" TIMESTAMP(3),
    "lastFixAccuracyM" INTEGER,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "locationPermission" TEXT,
    "batteryOptimized" BOOLEAN,
    "batteryPct" INTEGER,
    "locationMode" TEXT,
    "appVersion" TEXT,

    CONSTRAINT "DeviceHeartbeat_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeviceHeartbeat_userId_at_idx" ON "DeviceHeartbeat"("userId", "at");
CREATE INDEX "DeviceHeartbeat_at_idx" ON "DeviceHeartbeat"("at");

ALTER TABLE "DeviceHeartbeat" ADD CONSTRAINT "DeviceHeartbeat_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull, а не Cascade: відкликаний токен не має забирати з собою
-- історію того, як пристрій поводився.
ALTER TABLE "DeviceHeartbeat" ADD CONSTRAINT "DeviceHeartbeat_tokenId_fkey"
    FOREIGN KEY ("tokenId") REFERENCES "DeviceToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
