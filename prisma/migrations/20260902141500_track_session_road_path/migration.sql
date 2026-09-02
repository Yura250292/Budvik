-- Кеш лінії дня, покладеної на дороги. Не дані: сирі точки лишаються джерелом правди.
ALTER TABLE "TrackSession" ADD COLUMN "roadPath" JSONB;
ALTER TABLE "TrackSession" ADD COLUMN "roadPathPoints" INTEGER;
