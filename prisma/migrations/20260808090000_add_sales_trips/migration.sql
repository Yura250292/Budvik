-- Поїздки торгових представників (роль SALES у Telegram боті).
-- Міграція суто адитивна: жодного DROP і жодного NOT NULL на існуючих
-- таблицях, тож стара версія бота і адмінки продовжує працювати після
-- накатки. Саме це робить безпечним порядок деплою (міграція → адмінка →
-- схема бота → код бота).

-- CreateEnum
CREATE TYPE "SalesTripStatus" AS ENUM ('OPEN', 'CLOSED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "OdometerSource" AS ENUM ('AI', 'MANUAL', 'CORRECTED');

-- AlterTable
ALTER TABLE "WarehouseLinkRequest" ADD COLUMN     "assignedRole" "Role";

-- CreateTable
CREATE TABLE "SalesTrip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SalesTripStatus" NOT NULL DEFAULT 'OPEN',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startLat" DOUBLE PRECISION,
    "startLng" DOUBLE PRECISION,
    "startAddress" TEXT,
    "startAddressFull" TEXT,
    "startOdometer" INTEGER,
    "startOdometerSource" "OdometerSource",
    "startOdometerAiValue" INTEGER,
    "startPhotoUrl" TEXT,
    "startPhotoKey" TEXT,
    "startPhotoMimeType" TEXT,
    "startTelegramFileId" TEXT,
    "startConfirmedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endLat" DOUBLE PRECISION,
    "endLng" DOUBLE PRECISION,
    "endAddress" TEXT,
    "endAddressFull" TEXT,
    "endOdometer" INTEGER,
    "endOdometerSource" "OdometerSource",
    "endOdometerAiValue" INTEGER,
    "endPhotoUrl" TEXT,
    "endPhotoKey" TEXT,
    "endPhotoMimeType" TEXT,
    "endTelegramFileId" TEXT,
    "endConfirmedAt" TIMESTAMP(3),
    "distanceKm" INTEGER,
    "durationMinutes" INTEGER,
    "checkpointsCount" INTEGER NOT NULL DEFAULT 0,
    "odometerSuspicious" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTrip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesCheckpoint" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "addressFull" TEXT,
    "seq" INTEGER NOT NULL,
    "minutesFromPrev" INTEGER,
    "metersFromPrev" INTEGER,
    "clientNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesTrip_startTelegramFileId_key" ON "SalesTrip"("startTelegramFileId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesTrip_endTelegramFileId_key" ON "SalesTrip"("endTelegramFileId");

-- CreateIndex
CREATE INDEX "SalesTrip_userId_startedAt_idx" ON "SalesTrip"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "SalesTrip_status_idx" ON "SalesTrip"("status");

-- CreateIndex
CREATE INDEX "SalesTrip_startedAt_idx" ON "SalesTrip"("startedAt");

-- CreateIndex
CREATE INDEX "SalesCheckpoint_tripId_createdAt_idx" ON "SalesCheckpoint"("tripId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesCheckpoint_userId_createdAt_idx" ON "SalesCheckpoint"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesCheckpoint_tripId_seq_key" ON "SalesCheckpoint"("tripId", "seq");

-- AddForeignKey
ALTER TABLE "SalesTrip" ADD CONSTRAINT "SalesTrip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesCheckpoint" ADD CONSTRAINT "SalesCheckpoint_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "SalesTrip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesCheckpoint" ADD CONSTRAINT "SalesCheckpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
