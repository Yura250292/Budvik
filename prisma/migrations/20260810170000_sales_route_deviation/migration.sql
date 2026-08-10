-- Відхилення фактичного треку від призначеного маршруту.
--
-- IF NOT EXISTS — та сама причина, що й у попередніх міграціях: колонки
-- могли з'явитися вручну на проді, і повторний прогін не має валити деплой.

-- AlterTable: результат звірки з маршрутом, рахується при закритті поїздки
ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "routeTemplateId" TEXT;
ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "onRouteRatio" DOUBLE PRECISION;
ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "offRouteKm" INTEGER;
ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "excursions" JSONB;
ALTER TABLE "SalesTrip" ADD COLUMN IF NOT EXISTS "deviationAlertedAt" TIMESTAMP(3);

-- Індекс під єдиний реальний запит по цих полях: «покажи поїздки з
-- відхиленнями за період». Часткові — рядків з відхиленнями одиниці
-- відсотків, і повний індекс був би вчетверо більшим без користі.
CREATE INDEX IF NOT EXISTS "SalesTrip_offRoute_idx"
    ON "SalesTrip"("userId", "startedAt")
    WHERE "offRouteKm" IS NOT NULL AND "offRouteKm" > 0;

-- FK на RouteTemplate свідомо НЕМАЄ.
--
-- routeTemplateId — це знімок «з чим порівнювали в той день», а не жива
-- звʼязка. Видалення старого шаблону маршруту не повинно ні каскадом
-- зносити історію поїздок, ні падати з помилкою FK. Значення лишається
-- як довідка навіть тоді, коли сам шаблон уже видалили.
