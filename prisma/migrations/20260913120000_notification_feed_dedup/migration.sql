-- Стрічка подій торгового живе в Notification.
--
-- dedupKey — замок від повторів: воркер читає джерела (оплати, документи,
-- позначки складу) з перекриттям у хвилину, і без унікального ключа кожен
-- тік дописував би ті самі події. Старі рядки лишаються з NULL — Postgres
-- кілька NULL в унікальному індексі не вважає конфліктом.
--
-- pushedAt — чи пішов пуш. Поза 08:00–19:00 і понад денну стелю рядок
-- пишеться без нього; по ньому ж і рахується стеля.
ALTER TABLE "Notification"
  ADD COLUMN "dedupKey" TEXT,
  ADD COLUMN "pushedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Notification_dedupKey_key" ON "Notification"("dedupKey");

-- /api/notifications фільтрує по userId і сортує за createdAt; індексу досі
-- не було, а стрічка додасть десятки рядків на людину щодня.
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);
