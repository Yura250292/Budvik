-- Межа зони напрямку, виправлена руками, і радіус автоматичного коридору.
--
-- Обидва поля nullable без дефолту: null у zonePolygon означає «зона
-- рахується автоматично», і це не те саме, що порожній масив кілець
-- (він означав би «адмін стер зону начисто»).
ALTER TABLE "RouteTemplate" ADD COLUMN "zonePolygon" JSONB;
ALTER TABLE "RouteTemplate" ADD COLUMN "zoneRadiusKm" DOUBLE PRECISION;
