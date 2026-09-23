-- Сезонний профіль: як розподіляється рік усередині групи товарів.
--
-- Міграція написана РУКАМИ, і це не примха. `migrate diff` від прод-бази
-- до схеми хотів разом із цією таблицею дропнути "Product_name_trgm_idx" —
-- ручний GIN-індекс пошуку товарів, накочений CONCURRENTLY, про який
-- Prisma не знає. Ще він переписував два зовнішні ключі, яких ми не
-- чіпали. Узяти автодиф як міграцію означало б покласти пошук товарів на
-- проді заради нової таблиці.
--
-- Сумісність зі старим кодом ПОВНА: міграція лише додає два типи й одну
-- таблицю. Версія сайту, яка про них не знає, їх не помічає.

-- CreateEnum
CREATE TYPE "SeasonLevel" AS ENUM ('SKU', 'TYPE', 'SECTION', 'BRAND', 'COMPANY');

-- CreateEnum
CREATE TYPE "SeasonConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "SeasonProfile" (
    "id" TEXT NOT NULL,
    "level" "SeasonLevel" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "years" INTEGER[],
    "qtyIndex" DOUBLE PRECISION[],
    "amountIndex" DOUBLE PRECISION[],
    "monthly" JSONB NOT NULL,
    "yearAgreement" DOUBLE PRECISION,
    "amplitude" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "lumpy" BOOLEAN NOT NULL DEFAULT false,
    "docs" INTEGER NOT NULL DEFAULT 0,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" "SeasonConfidence" NOT NULL DEFAULT 'LOW',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SeasonProfile_level_confidence_idx" ON "SeasonProfile"("level", "confidence");

-- Перерахунок пише upsert-ом саме по цій парі: рівень плюс ключ.
CREATE UNIQUE INDEX "SeasonProfile_level_key_key" ON "SeasonProfile"("level", "key");
