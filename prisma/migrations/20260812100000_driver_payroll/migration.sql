-- Зарплата водіїв за маршрутними листами 1С.
--
-- Досі зарплата водіїв рахувалася вручну. Нарахування складається з трьох
-- частин, і всі три виводяться з маршрутного листа: ставка за пробіг (за
-- КОЖЕН лист, а не за день), надбавка за кожну унікальну точку вигрузки
-- (місто дорожче за область) і відсоток від суми замовлень за мінусом
-- боргів, які водій забирає за попередні доставки. Четверта частина —
-- ручні надбавки (Нова пошта тощо) — у 1С не існує взагалі.
--
-- RouteSheet окремо від DeliveryRoute навмисно: DeliveryRoute — планувальна
-- сутність сайту з обов'язковим автором і DeliveryStop.salesDocumentId
-- @unique, що зламало б прийом (те саме замовлення буває і в плановому
-- маршруті, і в листі 1С). Той самий поділ, що SalesDocument ≠ Order.
--
-- Усе additive: наявні таблиці лише отримують нові nullable-колонки.

CREATE TYPE "DeliveryZone" AS ENUM ('CITY', 'OBLAST');

-- Ручний override зони точки. null — визначаємо автоматично (полігон
-- об'їзної за координатами, далі евристика адреси). Геокодування іноді
-- дає адресу без області, тому останнє слово лишається за адміном.
ALTER TABLE "Counterparty" ADD COLUMN "deliveryZone" "DeliveryZone";

-- Прив'язка акаунта до водія з 1С. Поле, а не окрема таблиця: водіїв
-- одиниці, зв'язок 1:1, історія перепризначень не потрібна.
ALTER TABLE "User" ADD COLUMN "driver1CExternalId" TEXT;
CREATE UNIQUE INDEX "User_driver1CExternalId_key" ON "User"("driver1CExternalId");

CREATE TABLE "RouteSheet" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "posted" BOOLEAN NOT NULL DEFAULT true,
    "driverName1C" TEXT,
    "driverExternalId1C" TEXT,
    "driverId" TEXT,
    "vehicle" TEXT,
    "distanceKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ordersTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "debtsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteSheet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RouteSheet_externalId_key" ON "RouteSheet"("externalId");
CREATE INDEX "RouteSheet_driverId_date_idx" ON "RouteSheet"("driverId", "date");
CREATE INDEX "RouteSheet_date_idx" ON "RouteSheet"("date");
-- Під ретро-прив'язку водія: після мапінгу оновлюємо всі його старі листи.
CREATE INDEX "RouteSheet_driverExternalId1C_idx" ON "RouteSheet"("driverExternalId1C");

CREATE TABLE "RouteSheetStop" (
    "id" TEXT NOT NULL,
    "routeSheetId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "counterpartyId" TEXT,
    "salesDocumentId" TEXT,
    "address" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "debtAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "RouteSheetStop_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RouteSheetStop_routeSheetId_idx" ON "RouteSheetStop"("routeSheetId");
CREATE INDEX "RouteSheetStop_counterpartyId_idx" ON "RouteSheetStop"("counterpartyId");

CREATE TABLE "DriverBonus" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverBonus_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DriverBonus_driverId_date_idx" ON "DriverBonus"("driverId", "date");
CREATE INDEX "DriverBonus_date_idx" ON "DriverBonus"("date");

-- Один рядок на всю систему (id = 'default'). Ставки міняє адмін без
-- розробника; історії немає — зміна перераховує і минулі періоди.
CREATE TABLE "DriverPayrollRates" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "kmTier1Max" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "kmTier1Rate" DOUBLE PRECISION NOT NULL DEFAULT 500,
    "kmTier2Max" DOUBLE PRECISION NOT NULL DEFAULT 300,
    "kmTier2Rate" DOUBLE PRECISION NOT NULL DEFAULT 700,
    "kmTier3Rate" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "cityPointRate" DOUBLE PRECISION NOT NULL DEFAULT 25,
    "oblastPointRate" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "turnoverPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverPayrollRates_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RouteSheet" ADD CONSTRAINT "RouteSheet_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RouteSheetStop" ADD CONSTRAINT "RouteSheetStop_routeSheetId_fkey"
    FOREIGN KEY ("routeSheetId") REFERENCES "RouteSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RouteSheetStop" ADD CONSTRAINT "RouteSheetStop_counterpartyId_fkey"
    FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RouteSheetStop" ADD CONSTRAINT "RouteSheetStop_salesDocumentId_fkey"
    FOREIGN KEY ("salesDocumentId") REFERENCES "SalesDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DriverBonus" ADD CONSTRAINT "DriverBonus_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DriverBonus" ADD CONSTRAINT "DriverBonus_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
