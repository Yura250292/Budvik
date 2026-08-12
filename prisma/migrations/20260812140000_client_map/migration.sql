-- CreateEnum
CREATE TYPE "GeoSource" AS ENUM ('GEOCODED', 'MANUAL', 'FAILED');

-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'CONVERTED', 'REJECTED');

-- AlterTable
ALTER TABLE "Counterparty" ADD COLUMN     "geoAttemptedAt" TIMESTAMP(3),
ADD COLUMN     "geoSource" "GeoSource";

-- CreateTable
CREATE TABLE "ProspectClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "status" "ProspectStatus" NOT NULL DEFAULT 'NEW',
    "assignedRepId" TEXT,
    "createdById" TEXT,
    "counterpartyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProspectClient_counterpartyId_key" ON "ProspectClient"("counterpartyId");

-- CreateIndex
CREATE INDEX "ProspectClient_status_idx" ON "ProspectClient"("status");

-- CreateIndex
CREATE INDEX "ProspectClient_assignedRepId_idx" ON "ProspectClient"("assignedRepId");

-- AddForeignKey
ALTER TABLE "ProspectClient" ADD CONSTRAINT "ProspectClient_assignedRepId_fkey" FOREIGN KEY ("assignedRepId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectClient" ADD CONSTRAINT "ProspectClient_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectClient" ADD CONSTRAINT "ProspectClient_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
