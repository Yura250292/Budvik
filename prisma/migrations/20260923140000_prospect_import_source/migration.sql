-- Точки для розпрацювання з імпортованих списків (перший — «База Львів»).
--
-- Написано руками з тієї ж причини, що й 20260923120000_season_profile:
-- автодиф від проду тягне за собою дроп ручного GIN-індексу пошуку.
--
-- Сумісність зі старим кодом повна: три nullable-колонки й індекс. Версія
-- сайту, яка про них не знає, читає prospects явним select і їх не помічає.

-- AlterTable
ALTER TABLE "ProspectClient" ADD COLUMN "source" TEXT,
ADD COLUMN "externalCode" TEXT,
ADD COLUMN "details" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "ProspectClient_source_externalCode_key" ON "ProspectClient"("source", "externalCode");
