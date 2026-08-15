-- Зміна торгового з фото одометра.
-- Індекси без CONCURRENTLY: у міграції Prisma воно падає з 25001 і
-- блокує всі наступні. TrackPoint велика, але ALTER TABLE ADD COLUMN
-- з nullable-полем у Postgres не переписує таблицю.

CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED', 'ABANDONED');
CREATE TYPE "TrackPhase" AS ENUM ('SHIFT', 'AFTER_SHIFT');

CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',

    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startLat" DOUBLE PRECISION,
    "startLng" DOUBLE PRECISION,
    "startOdometer" INTEGER NOT NULL,
    "startOdometerSource" "OdometerSource" NOT NULL,
    "startOdometerAiValue" INTEGER,
    "startOdometerConfidence" DOUBLE PRECISION,
    "startPhotoUrl" TEXT,
    "startPhotoKey" TEXT,
    "startPhotoSha256" TEXT,
    "startConfirmedAt" TIMESTAMP(3),

    "endedAt" TIMESTAMP(3),
    "endLat" DOUBLE PRECISION,
    "endLng" DOUBLE PRECISION,
    "endOdometer" INTEGER,
    "endOdometerSource" "OdometerSource",
    "endOdometerAiValue" INTEGER,
    "endOdometerConfidence" DOUBLE PRECISION,
    "endPhotoUrl" TEXT,
    "endPhotoKey" TEXT,
    "endPhotoSha256" TEXT,
    "endConfirmedAt" TIMESTAMP(3),

    "distanceKm" INTEGER,
    "durationMinutes" INTEGER,
    "gpsDistanceKm" DOUBLE PRECISION,
    "odometerToGpsRatio" DOUBLE PRECISION,
    "personalKm" INTEGER,
    "odometerSuspicious" BOOLEAN NOT NULL DEFAULT false,

    "closedAutomatically" BOOLEAN NOT NULL DEFAULT false,
    "autoClosedByShiftId" TEXT,
    "clientRequestId" TEXT,

    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShiftOdometerRead" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT,
    "userId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "photoUrl" TEXT,
    "photoKey" TEXT,
    "photoSha256" TEXT,
    "aiValue" INTEGER,
    "aiConfidence" DOUBLE PRECISION,
    "aiDigitsRead" TEXT,
    "aiIsTripMeter" BOOLEAN NOT NULL DEFAULT false,
    "rejectedReason" TEXT,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShiftOdometerRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Shift_clientRequestId_key" ON "Shift"("clientRequestId");
CREATE INDEX "Shift_userId_startedAt_idx" ON "Shift"("userId", "startedAt");
CREATE INDEX "Shift_status_idx" ON "Shift"("status");

-- Головний запобіжник: у людини не може бути двох відкритих змін.
-- Ловить подвійний тап і ретрай пристрою на рівні бази, а не коду.
CREATE UNIQUE INDEX "Shift_one_open_per_user" ON "Shift"("userId") WHERE "status" = 'OPEN';

CREATE INDEX "ShiftOdometerRead_userId_createdAt_idx" ON "ShiftOdometerRead"("userId", "createdAt");
CREATE INDEX "ShiftOdometerRead_shiftId_idx" ON "ShiftOdometerRead"("shiftId");

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ShiftOdometerRead" ADD CONSTRAINT "ShiftOdometerRead_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Прив'язка треку до зміни
ALTER TABLE "TrackPoint" ADD COLUMN "shiftId" TEXT;
ALTER TABLE "TrackPoint" ADD COLUMN "phase" "TrackPhase";

CREATE INDEX "TrackPoint_shiftId_recordedAt_idx" ON "TrackPoint"("shiftId", "recordedAt");

ALTER TABLE "TrackPoint" ADD CONSTRAINT "TrackPoint_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
