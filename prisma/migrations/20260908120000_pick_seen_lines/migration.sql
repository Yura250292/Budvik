-- Що складовщик уже бачив у накладній, яку взявся збирати.
--
-- Знімок ставиться, коли він відмічає першу позицію. Усе, що менеджер допише
-- після цього, стає новиною — і про неї йде пуш. Без такої мітки довелося б
-- або порівнювати «було/стало» в момент обміну (а він переписує рядки цілком
-- і не знає, кому це цікаво), або слати сповіщення про кожну накладну.
CREATE TABLE "PickSeenLine" (
    "id" TEXT NOT NULL,
    "salesDocumentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PickSeenLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PickSeenLine_salesDocumentId_productId_key" ON "PickSeenLine"("salesDocumentId", "productId");
CREATE INDEX "PickSeenLine_salesDocumentId_idx" ON "PickSeenLine"("salesDocumentId");

ALTER TABLE "PickSeenLine" ADD CONSTRAINT "PickSeenLine_salesDocumentId_fkey"
  FOREIGN KEY ("salesDocumentId") REFERENCES "SalesDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
