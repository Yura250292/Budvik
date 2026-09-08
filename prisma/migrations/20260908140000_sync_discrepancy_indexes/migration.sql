-- Журнал розбіжностей читали повним скануванням.
--
-- До цього індексу тут був лише [syncJobId, field] — під закриття прогону.
-- Але щопрогону журнал питають ще двічі, і зовсім іншим ключем: `unresolvedRefs`
-- шукає нерозв'язані розбіжності одного виду (entityType + field + resolved),
-- а запобіжник цін — чи називала 1С цю саму ціну раніше (field + entityRef).
-- Обидва читали таблицю цілком: 43 тис. послідовних сканів і 3 млрд кортежів,
-- і кожен вимивав каталог із 128 МБ shared_buffers.
--
-- Таблиця після чистки мала (62 МБ), тому CONCURRENTLY не потрібен: звичайний
-- CREATE INDEX тут — секунди, а CONCURRENTLY у Prisma падає з 25001 і блокує
-- наступні міграції.
CREATE INDEX "SyncDiscrepancy_entityType_field_resolved_idx"
  ON "SyncDiscrepancy"("entityType", "field", "resolved");

CREATE INDEX "SyncDiscrepancy_field_entityRef_createdAt_idx"
  ON "SyncDiscrepancy"("field", "entityRef", "createdAt");
