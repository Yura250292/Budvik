-- Порядок обʼїзду, який водій склав собі.
--
-- Окремою таблицею, а не полем sequence у точках: RouteSheetStop приїжджає
-- обміном із 1С і переписаний порядок затерло б наступним же обміном, а
-- DeliveryStop.sequence належить логісту — підмінювати його з планшета
-- означало б, що офіс і водій говорять про різні маршрути.
CREATE TABLE "DriverRouteOrder" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "routeKey" TEXT NOT NULL,
    "stopKeys" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverRouteOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriverRouteOrder_driverId_routeKey_key" ON "DriverRouteOrder"("driverId", "routeKey");

ALTER TABLE "DriverRouteOrder" ADD CONSTRAINT "DriverRouteOrder_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
