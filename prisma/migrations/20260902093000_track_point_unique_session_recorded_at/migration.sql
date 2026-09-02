-- Дублі точок треку: наслідок перевідправки завислої пачки (01–02.09, 312 рядків).
-- Прибрані скриптом scripts/dedupe-track-points.mts перед створенням індексу.
DROP INDEX IF EXISTS "TrackPoint_sessionId_recordedAt_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "TrackPoint_sessionId_recordedAt_key"
  ON "TrackPoint"("sessionId", "recordedAt");
