-- AlterTable
-- Розбивка дебіторки за строками зі звіту 1С «Дебіторська заборгованість
-- за строками боргу». Без неї видно лише загальне сальдо: у ньому немає
-- дат, тож протерміновану частину з одного числа не вивести.
-- IF NOT EXISTS — щоб повторний прогін не валив деплой.
ALTER TABLE "Counterparty" ADD COLUMN IF NOT EXISTS "debtCurrent" DOUBLE PRECISION;
ALTER TABLE "Counterparty" ADD COLUMN IF NOT EXISTS "debtOverdue30" DOUBLE PRECISION;
ALTER TABLE "Counterparty" ADD COLUMN IF NOT EXISTS "debtOverdue60" DOUBLE PRECISION;
ALTER TABLE "Counterparty" ADD COLUMN IF NOT EXISTS "debtOverdue90" DOUBLE PRECISION;
ALTER TABLE "Counterparty" ADD COLUMN IF NOT EXISTS "debtOverdue90Plus" DOUBLE PRECISION;
ALTER TABLE "Counterparty" ADD COLUMN IF NOT EXISTS "debtAgingSyncedAt" TIMESTAMP(3);

-- Дебіторка рахується по контрагентах із ненульовим сальдо; без індексу
-- це послідовний скан по 3689 рядках на кожен запит зведеної таблиці.
CREATE INDEX IF NOT EXISTS "Counterparty_receivableBalance_idx"
  ON "Counterparty" ("receivableBalance")
  WHERE "receivableBalance" > 0;

-- CreateTable
-- Знімок дебіторки на кінець дня. 1С віддає лише поточне сальдо, тож без
-- історії неможливо сказати, чи борг за місяць виріс, чи торговий його
-- закрив — а саме на прирості рахується зарплата.
CREATE TABLE IF NOT EXISTS "DebtSnapshot" (
    "id" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL,
    "current" DOUBLE PRECISION,
    "overdue30" DOUBLE PRECISION,
    "overdue60" DOUBLE PRECISION,
    "overdue90" DOUBLE PRECISION,
    "overdue90Plus" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebtSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DebtSnapshot_counterpartyId_day_key"
  ON "DebtSnapshot" ("counterpartyId", "day");
CREATE INDEX IF NOT EXISTS "DebtSnapshot_day_idx" ON "DebtSnapshot" ("day");

DO $$ BEGIN
  ALTER TABLE "DebtSnapshot" ADD CONSTRAINT "DebtSnapshot_counterpartyId_fkey"
    FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
