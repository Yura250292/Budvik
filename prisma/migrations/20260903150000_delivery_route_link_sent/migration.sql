-- Слід про надіслане водієві посилання Google Maps.
--
-- Передача маршруту (assignedAt) і відправка дороги — різні дії: водій може
-- бачити маршрут у планшеті, але не мати посилання в месенджері. Без цих
-- полів «надіслати» лишалося б дією без пам'яті, і логіст на десятку карток
-- не знав би, кому вже відправив.
--
-- linkSentStops — кількість точок у мить відправки: якщо маршрут відтоді
-- правили, картка сама попросить надіслати ще раз.
ALTER TABLE "DeliveryRoute" ADD COLUMN "linkSentAt" TIMESTAMP(3);
ALTER TABLE "DeliveryRoute" ADD COLUMN "linkSentVia" TEXT;
ALTER TABLE "DeliveryRoute" ADD COLUMN "linkSentStops" INTEGER;
