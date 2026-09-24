-- Конектор Google Calendar: підключення акаунта й мапінг подій.
--
-- Навіщо. Робочий день співробітника (задачі зі строком, маршрут доставки,
-- нагадування, напрямок на день) живе лише всередині сайту. Конектор
-- виштовхує його в окремий календар «Budvik» у Google-акаунті людини, щоб
-- день був у телефоні поруч із рештою її життя.
--
-- Чому дві таблиці, а не колонки в ERP. Конектор навмисно знімний: у
-- DeliveryRoute і StaffTask не додано жодного поля, тож вимкнути його можна
-- двома DROP TABLE, а не чисткою бізнес-моделей. До того ж розклад напрямків
-- не має одного запису на одну подію — правило «щосереди Радехів» це N подій
-- на вікні, і в колонку такий ключ не вкладається взагалі.
--
-- Сумісність зі старим кодом ПОВНА: міграція лише додає дві таблиці. Версія
-- сайту, яка про них не знає, їх не помічає, тож порядок «спершу міграція,
-- потім код» тут безпечний. Поки міграції немає, конектор просто мовчить.

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "googleEmail" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "scope" TEXT NOT NULL,
    "calendarId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEventLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEventLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_userId_key" ON "CalendarConnection"("userId");

-- CreateIndex
CREATE INDEX "CalendarEventLink_state_nextAttemptAt_idx" ON "CalendarEventLink"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "CalendarEventLink_userId_entity_idx" ON "CalendarEventLink"("userId", "entity");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventLink_userId_entity_entityId_key" ON "CalendarEventLink"("userId", "entity", "entityId");

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

