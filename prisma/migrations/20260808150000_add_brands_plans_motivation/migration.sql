-- Бренди, плани та мотивація торгових.
-- Комісія рахується від ЗІБРАНИХ грошей, а не від обороту.
-- Міграція адитивна: нові таблиці + nullable колонки.

-- CreateEnum
CREATE TYPE "PlanPeriod" AS ENUM ('DAY', 'WEEK', 'MONTH', 'QUARTER');

-- CreateEnum
CREATE TYPE "PlanMetric" AS ENUM ('COLLECTED_AMOUNT', 'REVENUE', 'PROFIT', 'SKU_COUNT', 'CLIENTS_COUNT', 'CHECKPOINTS', 'OVERDUE_RATIO');

-- CreateEnum
CREATE TYPE "MotivationRuleType" AS ENUM ('PERCENT_OF_PROFIT', 'PERCENT_OF_COLLECTED', 'PLAN_BONUS_FIXED', 'PLAN_BONUS_PERCENT', 'TIERED_PERCENT', 'OVERDUE_PENALTY');

-- CreateEnum
CREATE TYPE "ReceivableBucket" AS ENUM ('CURRENT', 'OVERDUE_30', 'OVERDUE_60', 'OVERDUE_90', 'OVERDUE_90_PLUS');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "brandId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "matchPatterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesPlan" (
    "id" TEXT NOT NULL,
    "period" "PlanPeriod" NOT NULL,
    "metric" "PlanMetric" NOT NULL DEFAULT 'COLLECTED_AMOUNT',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "repId" TEXT,
    "brandId" TEXT,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotivationScheme" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotivationScheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotivationRule" (
    "id" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "type" "MotivationRuleType" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "brandId" TEXT,
    "categoryGroup" TEXT,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "planMetric" "PlanMetric",
    "thresholdFrom" DOUBLE PRECISION,
    "thresholdTo" DOUBLE PRECISION,
    "overdueTolerance" DOUBLE PRECISION,
    "notes" TEXT,

    CONSTRAINT "MotivationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotivationAssignment" (
    "id" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),

    CONSTRAINT "MotivationAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "profitAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "brandId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'DOCUMENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_externalId_key" ON "Brand"("externalId");

-- CreateIndex
CREATE INDEX "Brand_isActive_priority_idx" ON "Brand"("isActive", "priority");

-- CreateIndex
CREATE INDEX "SalesPlan_periodStart_period_idx" ON "SalesPlan"("periodStart", "period");

-- CreateIndex
CREATE INDEX "SalesPlan_repId_periodStart_idx" ON "SalesPlan"("repId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "SalesPlan_period_metric_periodStart_repId_brandId_key" ON "SalesPlan"("period", "metric", "periodStart", "repId", "brandId");

-- CreateIndex
CREATE INDEX "MotivationScheme_isActive_idx" ON "MotivationScheme"("isActive");

-- CreateIndex
CREATE INDEX "MotivationRule_schemeId_sortOrder_idx" ON "MotivationRule"("schemeId", "sortOrder");

-- CreateIndex
CREATE INDEX "MotivationAssignment_repId_validFrom_idx" ON "MotivationAssignment"("repId", "validFrom");

-- CreateIndex
CREATE INDEX "PaymentAllocation_repId_createdAt_idx" ON "PaymentAllocation"("repId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_externalId_key" ON "Payment"("externalId");

-- CreateIndex
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

-- AddForeignKey
ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesPlan" ADD CONSTRAINT "SalesPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotivationRule" ADD CONSTRAINT "MotivationRule_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "MotivationScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotivationRule" ADD CONSTRAINT "MotivationRule_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotivationAssignment" ADD CONSTRAINT "MotivationAssignment_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotivationAssignment" ADD CONSTRAINT "MotivationAssignment_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "MotivationScheme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;