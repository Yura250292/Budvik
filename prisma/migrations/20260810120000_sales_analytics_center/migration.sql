-- CreateTable
CREATE TABLE "RouteTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "routeGeometry" JSONB,
    "totalDistanceKm" DOUBLE PRECISION,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteTemplateStop" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "settlement" TEXT NOT NULL,
    "displayName" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RouteTemplateStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteAssignment" (
    "id" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "weekday" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesVehicle" (
    "id" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "label" TEXT,
    "fuelConsumption" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "fuelPricePerL" DOUBLE PRECISION NOT NULL DEFAULT 56,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RouteTemplate_isActive_idx" ON "RouteTemplate"("isActive");

-- CreateIndex
CREATE INDEX "RouteTemplateStop_templateId_seq_idx" ON "RouteTemplateStop"("templateId", "seq");

-- CreateIndex
CREATE INDEX "RouteAssignment_date_idx" ON "RouteAssignment"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RouteAssignment_repId_date_key" ON "RouteAssignment"("repId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RouteAssignment_repId_weekday_key" ON "RouteAssignment"("repId", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "SalesVehicle_repId_key" ON "SalesVehicle"("repId");

-- AddForeignKey
ALTER TABLE "RouteTemplate" ADD CONSTRAINT "RouteTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteTemplateStop" ADD CONSTRAINT "RouteTemplateStop_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RouteTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteAssignment" ADD CONSTRAINT "RouteAssignment_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteAssignment" ADD CONSTRAINT "RouteAssignment_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RouteTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesVehicle" ADD CONSTRAINT "SalesVehicle_repId_fkey" FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

