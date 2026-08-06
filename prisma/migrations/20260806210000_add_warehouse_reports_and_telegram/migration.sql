-- CreateEnum
CREATE TYPE "WarehouseShiftStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "WarehouseReportStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "telegramId" TEXT,
ADD COLUMN     "telegramUsername" TEXT;

-- CreateTable
CREATE TABLE "WarehouseShift" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "WarehouseShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openLat" DOUBLE PRECISION,
    "openLng" DOUBLE PRECISION,
    "openAddress" TEXT,
    "openAddressFull" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeLat" DOUBLE PRECISION,
    "closeLng" DOUBLE PRECISION,
    "closeAddress" TEXT,
    "closeAddressFull" TEXT,
    "durationMinutes" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shiftId" TEXT,
    "status" "WarehouseReportStatus" NOT NULL DEFAULT 'PENDING',
    "telegramMessageId" TEXT,
    "telegramFileId" TEXT,
    "mediaGroupId" TEXT,
    "batchId" TEXT,
    "photoUrl" TEXT NOT NULL,
    "photoKey" TEXT NOT NULL,
    "photoMimeType" TEXT,
    "photoSize" INTEGER,
    "docType" TEXT,
    "docNumber" TEXT,
    "docDate" TIMESTAMP(3),
    "counterpartyName" TEXT,
    "counterpartyCode" TEXT,
    "matchedCounterpartyId" TEXT,
    "totalAmount" DOUBLE PRECISION,
    "itemsCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "rawResponse" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarehouseReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseReportItem" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT,
    "lineTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "matchedProductId" TEXT,
    "matchedProductName" TEXT,
    "matchedProductPrice" DOUBLE PRECISION,

    CONSTRAINT "WarehouseReportItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseLinkRequest" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "telegramName" TEXT,
    "code" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "linkedUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseLinkRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE INDEX "WarehouseShift_userId_openedAt_idx" ON "WarehouseShift"("userId", "openedAt");

-- CreateIndex
CREATE INDEX "WarehouseShift_status_idx" ON "WarehouseShift"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseReport_telegramFileId_key" ON "WarehouseReport"("telegramFileId");

-- CreateIndex
CREATE INDEX "WarehouseReport_userId_createdAt_idx" ON "WarehouseReport"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WarehouseReport_status_createdAt_idx" ON "WarehouseReport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WarehouseReport_shiftId_idx" ON "WarehouseReport"("shiftId");

-- CreateIndex
CREATE INDEX "WarehouseReport_mediaGroupId_idx" ON "WarehouseReport"("mediaGroupId");

-- CreateIndex
CREATE INDEX "WarehouseReportItem_reportId_idx" ON "WarehouseReportItem"("reportId");

-- CreateIndex
CREATE INDEX "WarehouseReportItem_matchedProductId_idx" ON "WarehouseReportItem"("matchedProductId");

-- CreateIndex
CREATE INDEX "WarehouseReportItem_name_idx" ON "WarehouseReportItem"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseLinkRequest_code_key" ON "WarehouseLinkRequest"("code");

-- CreateIndex
CREATE INDEX "WarehouseLinkRequest_telegramId_idx" ON "WarehouseLinkRequest"("telegramId");

-- CreateIndex
CREATE INDEX "WarehouseLinkRequest_approved_expiresAt_idx" ON "WarehouseLinkRequest"("approved", "expiresAt");

-- AddForeignKey
ALTER TABLE "WarehouseShift" ADD CONSTRAINT "WarehouseShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseReport" ADD CONSTRAINT "WarehouseReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseReport" ADD CONSTRAINT "WarehouseReport_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "WarehouseShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseReport" ADD CONSTRAINT "WarehouseReport_matchedCounterpartyId_fkey" FOREIGN KEY ("matchedCounterpartyId") REFERENCES "Counterparty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseReportItem" ADD CONSTRAINT "WarehouseReportItem_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "WarehouseReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseReportItem" ADD CONSTRAINT "WarehouseReportItem_matchedProductId_fkey" FOREIGN KEY ("matchedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarehouseLinkRequest" ADD CONSTRAINT "WarehouseLinkRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
