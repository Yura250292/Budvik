-- Вебаналітика відвідувачів магазину: сирі події + денний зріз.
--
-- Обидві таблиці нові й порожні — наявних даних міграція не торкається.
-- Індекси звичайні, не CONCURRENTLY: блокувати в порожній таблиці нічого,
-- а CONCURRENTLY у prisma migrate падає з 25001 і блокує наступні міграції.
--
-- Індексів на SiteEvent чотири, бо кожен обслуговує свій звіт:
--   createdAt        — вибірка за період (усі вкладки);
--   type, createdAt  — «скільки пошуків/кліків за тиждень»;
--   sessionId        — воронка через COUNT(DISTINCT sessionId);
--   productId, type  — топ товарів і конверсія перегляд→кошик.

CREATE TABLE "SiteEvent" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "path" TEXT,
    "productId" TEXT,
    "query" TEXT,
    "label" TEXT,
    "value" INTEGER,
    "referrer" TEXT,
    "refCode" TEXT,
    "device" TEXT,
    "browser" TEXT,
    "country" TEXT,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SiteEvent_createdAt_idx" ON "SiteEvent"("createdAt");
CREATE INDEX "SiteEvent_type_createdAt_idx" ON "SiteEvent"("type", "createdAt");
CREATE INDEX "SiteEvent_sessionId_idx" ON "SiteEvent"("sessionId");
CREATE INDEX "SiteEvent_productId_type_idx" ON "SiteEvent"("productId", "type");

CREATE TABLE "SiteDailyStat" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "visitors" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "productViews" INTEGER NOT NULL DEFAULT 0,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "addToCarts" INTEGER NOT NULL DEFAULT 0,
    "ordersPlaced" INTEGER NOT NULL DEFAULT 0,
    "phoneClicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteDailyStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SiteDailyStat_date_key" ON "SiteDailyStat"("date");
