-- Заявки торгових в офіс.
--
-- «Заведіть клієнта», «змініть телефон», «дайте відстрочку» досі йшли
-- дзвінком і губилися. Тепер це рядок зі статусом: офіс бачить відкриті в
-- адмінці, торговий — відповідь. У 1С сайт не пише: заявку виконує людина.
CREATE TABLE "OfficeRequest" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "counterpartyId" TEXT,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "answer" TEXT,
    "doneById" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OfficeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OfficeRequest_status_createdAt_idx" ON "OfficeRequest"("status", "createdAt");
CREATE INDEX "OfficeRequest_authorId_createdAt_idx" ON "OfficeRequest"("authorId", "createdAt");

ALTER TABLE "OfficeRequest" ADD CONSTRAINT "OfficeRequest_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
