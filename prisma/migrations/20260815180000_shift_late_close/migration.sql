-- Пізнє закриття зміни: торговий згадав увечері вдома, коли фото
-- одометра зробити вже нема як.

ALTER TABLE "Shift" ADD COLUMN "closedLate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shift" ADD COLUMN "lateCloseSource" TEXT;
ALTER TABLE "Shift" ADD COLUMN "afterWorkKm" DOUBLE PRECISION;
