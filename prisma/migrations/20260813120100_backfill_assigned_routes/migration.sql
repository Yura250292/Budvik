-- Бекфіл: наявні маршрути вважаються вже переданими водію.
--
-- До цієї зміни PLANNED означав одночасно «чернетка» і «виданий водію», і
-- планшет показував будь-який PLANNED. Якщо просто ввімкнути фільтр за
-- ASSIGNED, водії втратили б поточні маршрути. Тому все, що вже існує і має
-- водія, разово переводимо в ASSIGNED з часом передачі = час створення.
--
-- Окрема міграція, бо Postgres не дозволяє використати значення enum у тій
-- самій транзакції, в якій воно додане через ALTER TYPE ... ADD VALUE.

UPDATE "DeliveryRoute"
SET "status" = 'ASSIGNED',
    "assignedAt" = COALESCE("assignedAt", "createdAt"),
    "assignedById" = COALESCE("assignedById", "createdById")
WHERE "status" = 'PLANNED'
  AND "driverId" IS NOT NULL;
