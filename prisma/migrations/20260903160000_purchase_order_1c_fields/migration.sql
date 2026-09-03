-- Прихідна накладна: поля документа надходження з 1С.
--
-- Таблиця досі наповнювалась лише вручну (канал purchase_doc не мав
-- виробника на боці агента), тож усі колонки додаються порожніми й
-- жоден наявний рядок не змінюється. Індекси звичайні, без CONCURRENTLY:
-- рядків одиниці, а CONCURRENTLY у міграції Prisma падає з 25001.

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "currencyCode" TEXT,
ADD COLUMN     "currencyRate" DOUBLE PRECISION,
ADD COLUMN     "stockLocationId" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "lineNo" INTEGER;

-- CreateIndex
CREATE INDEX "PurchaseOrder_createdAt_idx" ON "PurchaseOrder"("createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_createdAt_idx" ON "PurchaseOrder"("supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_stockLocationId_fkey" FOREIGN KEY ("stockLocationId") REFERENCES "StockLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
