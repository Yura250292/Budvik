-- Стан сторожа треку в пульсі.
--
-- Пульс шле сам сторож, тож поки він спить, із сервера це не відрізнити від
-- мертвого застосунку: 04.09 планшет написав 1845 точок і 2 пульси.
ALTER TABLE "DeviceHeartbeat" ADD COLUMN "watchdogAt" TIMESTAMP(3);
ALTER TABLE "DeviceHeartbeat" ADD COLUMN "watchdogStatus" TEXT;
