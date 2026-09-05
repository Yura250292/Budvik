-- Нагадування помічника: «нагадай у пʼятницю про борг Кунанця».
--
-- Окрема таблиця, а не поле в пам'яті клієнта: пам'ять — це те, що про
-- клієнта правда й лишається назавжди, а нагадування має дату й згорає.
--
-- notifiedAt, а не булеве «надіслано»: коли пуш пішов — це те, чого не
-- відновити з іншого місця, і саме за цим полем воркер добирає прострочені
-- нагадування після простою.

CREATE TABLE "AssistantReminder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "counterpartyId" TEXT,
    "text" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantReminder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantReminder_userId_dueAt_idx" ON "AssistantReminder"("userId", "dueAt");
CREATE INDEX "AssistantReminder_notifiedAt_dueAt_idx" ON "AssistantReminder"("notifiedAt", "dueAt");

ALTER TABLE "AssistantReminder" ADD CONSTRAINT "AssistantReminder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantReminder" ADD CONSTRAINT "AssistantReminder_counterpartyId_fkey"
    FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
