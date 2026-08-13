-- Передача маршруту водію + ручне коригування точок.
--
-- Три зміни:
--   1. Статус ASSIGNED і поля assignedAt/assignedById — явна передача.
--      До неї водій маршруту не бачить, логіст править чернетку вільно.
--   2. DeliveryStop.salesDocumentId стає nullable — бонусні поїздки
--      (забрати товар, відвезти ремонт на пошту) накладної не мають.
--   3. Тип точки, власні координати, ручна оплата й зона точки.

-- 1. Новий статус маршруту
ALTER TYPE "DeliveryRouteStatus" ADD VALUE IF NOT EXISTS 'ASSIGNED' AFTER 'PLANNED';

-- 2. Тип точки
DO $$ BEGIN
  CREATE TYPE "DeliveryStopKind" AS ENUM ('DELIVERY', 'PICKUP', 'ERRAND');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Поля передачі на маршруті
ALTER TABLE "DeliveryRoute" ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3);
ALTER TABLE "DeliveryRoute" ADD COLUMN IF NOT EXISTS "assignedById" TEXT;

ALTER TABLE "DeliveryRoute"
  DROP CONSTRAINT IF EXISTS "DeliveryRoute_assignedById_fkey";
ALTER TABLE "DeliveryRoute"
  ADD CONSTRAINT "DeliveryRoute_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "DeliveryRoute_driverId_date_idx"
  ON "DeliveryRoute"("driverId", "date");

-- 4. Поля точки
ALTER TABLE "DeliveryStop" ALTER COLUMN "salesDocumentId" DROP NOT NULL;
ALTER TABLE "DeliveryStop" ADD COLUMN IF NOT EXISTS "kind" "DeliveryStopKind" NOT NULL DEFAULT 'DELIVERY';
ALTER TABLE "DeliveryStop" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "DeliveryStop" ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION;
ALTER TABLE "DeliveryStop" ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;
ALTER TABLE "DeliveryStop" ADD COLUMN IF NOT EXISTS "payOverride" DOUBLE PRECISION;
ALTER TABLE "DeliveryStop" ADD COLUMN IF NOT EXISTS "zoneOverride" "DeliveryZone";

CREATE INDEX IF NOT EXISTS "DeliveryStop_deliveryRouteId_sequence_idx"
  ON "DeliveryStop"("deliveryRouteId", "sequence");
