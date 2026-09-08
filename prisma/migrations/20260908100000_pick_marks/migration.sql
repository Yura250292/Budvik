-- Позначки «зібрано» на рядках накладної, яку склад збирає ще до проведення.
--
-- Ключ (документ + товар), а не рядок документа: обмін на кожному циклі
-- видаляє рядки документа й створює заново, тож ідентифікатор рядка живе
-- п'ять хвилин. Позначка на ньому зникала б щоразу, коли менеджер дописує
-- в накладну ще одну позицію — тобто рівно тоді, коли вона потрібна.
--
-- Кількість, а не прапорець: у вже зібраному рядку кількість може вирости,
-- і складовщик має побачити «донести 2», а не «зібрати 12 наново».
CREATE TABLE "PickMark" (
    "id" TEXT NOT NULL,
    "salesDocumentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PickMark_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PickMark_salesDocumentId_productId_key" ON "PickMark"("salesDocumentId", "productId");
CREATE INDEX "PickMark_salesDocumentId_idx" ON "PickMark"("salesDocumentId");
CREATE INDEX "PickMark_userId_updatedAt_idx" ON "PickMark"("userId", "updatedAt");

ALTER TABLE "PickMark" ADD CONSTRAINT "PickMark_salesDocumentId_fkey"
  FOREIGN KEY ("salesDocumentId") REFERENCES "SalesDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PickMark" ADD CONSTRAINT "PickMark_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PickMark" ADD CONSTRAINT "PickMark_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
