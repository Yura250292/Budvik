-- Синхронізація з 1С: стабільні зовнішні ключі, дерево категорій,
-- реєстр батчів для ідемпотентності та стан агента.
-- Усі зміни адитивні — наявні дані й запити не зачіпаються.

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "Counterparty" ADD COLUMN     "balanceSyncedAt" TIMESTAMP(3),
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "receivableBalance" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "StockLocation" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "SalesDocument" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "externalId" TEXT;

-- CreateTable
CREATE TABLE "SyncBatch" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "entityType" TEXT NOT NULL,
    "records" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_externalId_key" ON "Category"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_externalId_key" ON "Product"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Counterparty_externalId_key" ON "Counterparty"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_externalId_key" ON "StockLocation"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocument_externalId_key" ON "SalesDocument"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_externalId_key" ON "PurchaseOrder"("externalId");

-- CreateIndex
CREATE INDEX "SyncBatch_runId_idx" ON "SyncBatch"("runId");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
