-- Розклад треку зміни: їзда, ходьба, стоянка.
--
-- Пробіг рахувався разом із тремтінням приймача на стоянках (3-17 км за
-- день) і разом зі слабкими фіксами. Тепер у пробіг іде лише їзда, а решта
-- лишається видимою окремими числами.
ALTER TABLE "Shift" ADD COLUMN "driveKm" DOUBLE PRECISION;
ALTER TABLE "Shift" ADD COLUMN "walkKm" DOUBLE PRECISION;
ALTER TABLE "Shift" ADD COLUMN "stopKm" DOUBLE PRECISION;
ALTER TABLE "Shift" ADD COLUMN "filledKm" DOUBLE PRECISION;
ALTER TABLE "Shift" ADD COLUMN "trackKmAt" TIMESTAMP(3);
