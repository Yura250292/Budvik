-- Фото локації клієнта в стрічці коментарів.
--
-- Чотири nullable-колонки: додавання таке не переписує таблицю і не тримає
-- довгого замка, тож безпечне на живій базі.
ALTER TABLE "ClientComment" ADD COLUMN "photoUrl" TEXT;
ALTER TABLE "ClientComment" ADD COLUMN "photoKey" TEXT;
ALTER TABLE "ClientComment" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "ClientComment" ADD COLUMN "lng" DOUBLE PRECISION;
