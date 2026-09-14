-- Наради й задачі команді.
--
-- Нарада — аудіозапис або текстова нотатка. Воркер проводить її через
-- розпізнавання (AssemblyAI) і підсумок (OpenAI) до структурованого запису:
-- про що говорили, які задачі роздали, як рухаємось по попередніх.
--
-- Задача з наради спершу лише пропозиція (PROPOSED): модель могла сплутати
-- людину чи клієнта, тож виконавець її не бачить, поки керівник не підтвердить.
-- Після підтвердження (ASSIGNED) воркер кладе рядок у стрічку й шле пуш.
--
-- Статуси рядками, а не enum — так само, як у заявках торгових: новий стан не
-- вимагає ALTER TYPE, а старий клієнт Prisma не падає на невідомому значенні.
-- Міграція лише додає таблиці, тож стара версія сайту чи воркера її не помічає.

CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "audioR2Key" TEXT,
    "audioMimeType" TEXT,
    "audioSizeBytes" INTEGER,
    "audioDurationMs" INTEGER,
    "noteText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "transcript" TEXT,
    "utterances" JSONB,
    "entities" JSONB,
    "speakerCount" INTEGER,
    "speakerMap" JSONB,
    "assemblyTranscriptId" TEXT,
    "summary" TEXT,
    "structured" JSONB,
    "aiModel" TEXT,
    "aiPromptTokens" INTEGER,
    "aiCompletionTokens" INTEGER,
    "transcribeAttempts" INTEGER NOT NULL DEFAULT 0,
    "summarizeAttempts" INTEGER NOT NULL DEFAULT 0,
    "processingError" TEXT,
    "lockedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "lastPolledAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3),
    "transcribedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- Черга воркера: «що в статусі X і вже можна брати».
CREATE INDEX "Meeting_status_nextAttemptAt_idx" ON "Meeting"("status", "nextAttemptAt");
-- Список нарад у адмінці — від свіжих.
CREATE INDEX "Meeting_recordedAt_idx" ON "Meeting"("recordedAt" DESC);

-- Автора наради не видаляємо разом із нарадою: записи керівництва не мають
-- зникати через те, що прибрали обліковий запис.
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "StaffTask" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT,
    "createdById" TEXT NOT NULL,
    "assigneeId" TEXT,
    "assigneeNameHeard" TEXT,
    "assigneeConfidence" DOUBLE PRECISION,
    "counterpartyId" TEXT,
    "clientNameHeard" TEXT,
    "clientHint" TEXT,
    "clientCandidates" JSONB,
    "clientConfidence" DOUBLE PRECISION,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "dueAt" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "sentAt" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "doneNote" TEXT,
    "doneNotifiedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "progressNote" TEXT,
    "progressAt" TIMESTAMP(3),
    "progressMeetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffTask_pkey" PRIMARY KEY ("id")
);

-- Кабінет виконавця: «мої відкриті, за дедлайном».
CREATE INDEX "StaffTask_assigneeId_status_dueAt_idx" ON "StaffTask"("assigneeId", "status", "dueAt");
CREATE INDEX "StaffTask_meetingId_idx" ON "StaffTask"("meetingId");
-- Воркер доставки: «підтверджені, про які ще не повідомили».
CREATE INDEX "StaffTask_status_pushedAt_idx" ON "StaffTask"("status", "pushedAt");
CREATE INDEX "StaffTask_createdById_status_createdAt_idx" ON "StaffTask"("createdById", "status", "createdAt" DESC);

-- Видалена нарада задачі не забирає: доручення вже могли виконувати.
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StaffTask" ADD CONSTRAINT "StaffTask_counterpartyId_fkey"
  FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
