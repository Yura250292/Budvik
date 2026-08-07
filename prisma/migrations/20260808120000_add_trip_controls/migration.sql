-- Контроль пробігу торгового.
--
-- Одометр каже, СКІЛЬКИ проїхано, але не каже КУДИ. Торговий може
-- накрутити кілометри реальною поїздкою у своїх справах — фото буде
-- чесне, AI прочитає правильно. Ловить це лише зіставлення з GPS.
--
-- Міграція адитивна: усі колонки nullable або з дефолтом.

-- AlterTable
ALTER TABLE "SalesTrip" ADD COLUMN     "gpsDistanceKm" INTEGER,
ADD COLUMN     "odometerToGpsRatio" DOUBLE PRECISION,
ADD COLUMN     "personalKm" INTEGER,
ADD COLUMN     "startPhotoSuspicious" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "endPhotoSuspicious" BOOLEAN NOT NULL DEFAULT false;
