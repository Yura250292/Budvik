-- База торгового: звідки він виїжджає вранці.
--
-- Усі три колонки nullable і без дефолтів: у кожного торгового своя
-- адреса, і вигадати її за нього не можна. Поки поле порожнє, панель
-- «план проти факту» чесно каже, що подача не врахована, замість
-- підставляти чужу точку і видавати похибку за факт.
ALTER TABLE "SalesVehicle" ADD COLUMN "baseAddress" TEXT;
ALTER TABLE "SalesVehicle" ADD COLUMN "baseLat" DOUBLE PRECISION;
ALTER TABLE "SalesVehicle" ADD COLUMN "baseLng" DOUBLE PRECISION;

-- Кеш подачі по шаблонах маршрутів: {"templateId": км}. JSONB, а не
-- окрема таблиця: рядків рівно стільки, скільки маршрутів у торгового,
-- і жодних запитів по них окремо не буде.
ALTER TABLE "SalesVehicle" ADD COLUMN "baseLegsKm" JSONB;
