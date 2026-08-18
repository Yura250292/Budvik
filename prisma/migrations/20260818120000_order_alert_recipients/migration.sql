-- Отримувачі Telegram-сповіщень про нове замовлення з сайту.
--
-- Таблиця нова й порожня — жодних змін наявних даних. Індекс по active
-- звичайний, не CONCURRENTLY: у момент створення таблиці блокувати нічого.

CREATE TABLE "OrderAlertRecipient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "code" TEXT NOT NULL,
    "telegramId" TEXT,
    "telegramUsername" TEXT,
    "linkedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderAlertRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderAlertRecipient_code_key" ON "OrderAlertRecipient"("code");
CREATE UNIQUE INDEX "OrderAlertRecipient_telegramId_key" ON "OrderAlertRecipient"("telegramId");
CREATE INDEX "OrderAlertRecipient_active_idx" ON "OrderAlertRecipient"("active");
