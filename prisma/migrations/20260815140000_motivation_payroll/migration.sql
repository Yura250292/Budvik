-- Розрахунок мотивації по валу: місяць з курсами і сходинками бонусу,
-- рядки валу торгових по валютах, групи «фірм за дужками» з
-- індивідуальними умовами та їхні місячні продажі.

-- CreateTable
CREATE TABLE "MotivationPayrollMonth" (
    "id" TEXT NOT NULL,
    "month" TIMESTAMP(3) NOT NULL,
    "usdRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "eurRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plnRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tiers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MotivationPayrollMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotivationPayrollEntry" (
    "id" TEXT NOT NULL,
    "monthId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "workDays" INTEGER NOT NULL DEFAULT 0,
    "planAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "factAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossUah" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossEur" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grossPln" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "clientBonuses" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "MotivationPayrollEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndividualTermsGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brands" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "IndividualTermsGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndividualTermsEntry" (
    "id" TEXT NOT NULL,
    "monthId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "salesAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rentCoef" DOUBLE PRECISION,
    "bonusPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "IndividualTermsEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MotivationPayrollMonth_month_key" ON "MotivationPayrollMonth"("month");

-- CreateIndex
CREATE UNIQUE INDEX "MotivationPayrollEntry_monthId_repId_key" ON "MotivationPayrollEntry"("monthId", "repId");

-- CreateIndex
CREATE UNIQUE INDEX "IndividualTermsEntry_monthId_groupId_repId_key" ON "IndividualTermsEntry"("monthId", "groupId", "repId");

-- CreateIndex
CREATE INDEX "IndividualTermsEntry_monthId_repId_idx" ON "IndividualTermsEntry"("monthId", "repId");

-- AddForeignKey
ALTER TABLE "MotivationPayrollEntry" ADD CONSTRAINT "MotivationPayrollEntry_monthId_fkey" FOREIGN KEY ("monthId") REFERENCES "MotivationPayrollMonth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MotivationPayrollEntry" ADD CONSTRAINT "MotivationPayrollEntry_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndividualTermsEntry" ADD CONSTRAINT "IndividualTermsEntry_monthId_fkey" FOREIGN KEY ("monthId") REFERENCES "MotivationPayrollMonth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndividualTermsEntry" ADD CONSTRAINT "IndividualTermsEntry_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "IndividualTermsGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndividualTermsEntry" ADD CONSTRAINT "IndividualTermsEntry_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
