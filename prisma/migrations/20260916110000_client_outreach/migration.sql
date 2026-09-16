-- Пропозиції клієнтам: хто, що, яким каналом і чим закінчилось.
--
-- Сайт повідомлень не надсилає: торговий відкриває Viber/Telegram/SMS зі
-- свого планшета з підготовленим текстом, а рядок фіксує, що пішло, і
-- дозволяє воркеру закрити результат за реалізацією в 1С (src/lib/outreach).
-- Та сама таблиця прийме й повідомлення майбутніх кампаній (source =
-- 'CAMPAIGN'), щоб частотна стеля й конверсія рахувались одним запитом.
--
-- Статуси рядками, а не enum. Міграція лише додає таблицю — стара версія
-- сайту чи воркера її не помічає.

CREATE TABLE "ClientOutreach" (
    "id" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "repId" TEXT,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'MARKETING',
    "source" TEXT NOT NULL DEFAULT 'REP',
    "text" TEXT NOT NULL,
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "campaignId" TEXT,
    "stateAtSend" TEXT,
    "daysSinceLastAtSend" INTEGER,
    "linkToken" TEXT,
    "clickedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL DEFAULT 'PENDING',
    "outcomeAt" TIMESTAMP(3),
    "outcomeBy" TEXT,
    "outcomeDocId" TEXT,
    "outcomeAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientOutreach_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientOutreach_linkToken_key" ON "ClientOutreach"("linkToken");
-- Картка клієнта й «без пропозиції 30 днів».
CREATE INDEX "ClientOutreach_counterpartyId_sentAt_idx" ON "ClientOutreach"("counterpartyId", "sentAt" DESC);
-- Таблиця по торгових в адмінці.
CREATE INDEX "ClientOutreach_repId_sentAt_idx" ON "ClientOutreach"("repId", "sentAt" DESC);
-- Воркер: відкриті пропозиції за останні три тижні.
CREATE INDEX "ClientOutreach_outcome_sentAt_idx" ON "ClientOutreach"("outcome", "sentAt");
CREATE INDEX "ClientOutreach_campaignId_idx" ON "ClientOutreach"("campaignId");

-- Клієнт видалений — його історія пропозицій не має сенсу.
ALTER TABLE "ClientOutreach" ADD CONSTRAINT "ClientOutreach_counterpartyId_fkey"
  FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Акаунт торгового прибрали — пропозиція лишається в статистиці.
ALTER TABLE "ClientOutreach" ADD CONSTRAINT "ClientOutreach_repId_fkey"
  FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClientOutreach" ADD CONSTRAINT "ClientOutreach_outcomeDocId_fkey"
  FOREIGN KEY ("outcomeDocId") REFERENCES "SalesDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
