-- Планшет у машині: живий веб-трек і чек-ліст візитів.
--
-- Планшет закріплений у машині, завжди на зарядці, вкладка з картою на
-- передньому плані. Тому трек збирає сам браузер (watchPosition + Wake
-- Lock), а не Telegram-бот: обмеження «фонова вкладка засинає» цей
-- сценарій обходить, і зникає залежність від месенджера.
--
-- Чому не перевикористали SalesTrip/SalesTrackPoint: там кожна точка
-- вимагає tripId, а поїздка відкривається ботом по фото одометра. Водій
-- нічого не фотографує і бота може не мати. Тут — вузькі власні таблиці
-- з тією самою математикою (metersFromPrev рахується при вставці).
--
-- Усе additive: жодна наявна таблиця не змінюється.

CREATE TYPE "VisitStatus" AS ENUM ('DONE', 'MISSED');

-- NOT_APPLICABLE окремо від NONE: «не було чого забирати» і «був борг,
-- але нічого не забрав» — різні події, і змішувати їх у звіті не можна.
CREATE TYPE "MoneyCollected" AS ENUM ('FULL', 'PARTIAL', 'NONE', 'NOT_APPLICABLE');

-- Трек-сесія = один робочий день однієї людини. Прив'язка до дня, а не
-- до «поїздки»: планшет вмикається зранку і гасне ввечері.
CREATE TABLE "TrackSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPointAt" TIMESTAMP(3),
    "pointsCount" INTEGER NOT NULL DEFAULT 0,
    "distanceKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackSession_pkey" PRIMARY KEY ("id")
);

-- День і людина однозначно визначають сесію: пачки точок роблять upsert
-- по цьому ключу, і паралельні вкладки не створять дублів.
CREATE UNIQUE INDEX "TrackSession_userId_day_key" ON "TrackSession"("userId", "day");
CREATE INDEX "TrackSession_day_idx" ON "TrackSession"("day");
-- «Хто зараз онлайн» — запит по цьому індексу, без сканування точок.
CREATE INDEX "TrackSession_lastPointAt_idx" ON "TrackSession"("lastPointAt");

-- Точка веб-треку. Свідомо вузька: день ≈ 100–300 точок на людину,
-- жодного зворотного геокодування при вставці.
CREATE TABLE "TrackPoint" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" INTEGER,
    "speedKmh" INTEGER,
    "headingDeg" INTEGER,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "metersFromPrev" INTEGER,
    "minutesFromPrev" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackPoint_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrackPoint_sessionId_recordedAt_idx" ON "TrackPoint"("sessionId", "recordedAt");
CREATE INDEX "TrackPoint_userId_recordedAt_idx" ON "TrackPoint"("userId", "recordedAt");

-- Відмітка про візит: приїхав / не потрапив, коментар, скільки забрав.
-- Точки маршрутного листа кажуть, куди ПЛАНУВАЛИ, трек — де БУВ,
-- а Visit — що там СТАЛОСЯ.
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "routeSheetStopId" TEXT,
    "deliveryStopId" TEXT,
    "status" "VisitStatus" NOT NULL,
    "comment" TEXT,
    "money" "MoneyCollected" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "collectedAmount" DOUBLE PRECISION,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracyM" INTEGER,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- Одна відмітка на клієнта за день: повторний тап редагує, а не плодить
-- дублі. Ловить і гонку подвійного натискання на рівні БД.
CREATE UNIQUE INDEX "Visit_userId_day_counterpartyId_key" ON "Visit"("userId", "day", "counterpartyId");
CREATE INDEX "Visit_day_idx" ON "Visit"("day");
CREATE INDEX "Visit_counterpartyId_day_idx" ON "Visit"("counterpartyId", "day");

ALTER TABLE "TrackSession" ADD CONSTRAINT "TrackSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackPoint" ADD CONSTRAINT "TrackPoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TrackSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackPoint" ADD CONSTRAINT "TrackPoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
