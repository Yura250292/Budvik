-- Помічник торгового: розмови, повідомлення й пам'ять про клієнта.
--
-- Три таблиці замість однієї: розмова живе довше за повідомлення (її
-- перейменовують, видаляють, рахують по ній токени), а пам'ять про клієнта
-- взагалі не належить розмові — вона лишається, коли діалог давно стерли.
--
-- entityIds у повідомленні — не надлишок, а запобіжник: за цим списком
-- перевіряються посилання у відповіді моделі, щоб вона не послалася на
-- клієнта, якого їй ніхто не показував.

CREATE TYPE "AssistantRole" AS ENUM ('USER', 'ASSISTANT', 'TOOL');
CREATE TYPE "ClientMemoryKind" AS ENUM ('PAYMENT', 'RELATIONSHIP', 'PREFERENCE', 'LOGISTICS', 'COMPETITOR', 'OTHER');
CREATE TYPE "ClientMemorySource" AS ENUM ('REP', 'ASSISTANT');

CREATE TABLE "AssistantThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "title" TEXT,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "busyUntil" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantThread_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantThread_userId_lastMessageAt_idx" ON "AssistantThread"("userId", "lastMessageAt" DESC);

CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" "AssistantRole" NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "toolCallId" TEXT,
    "toolName" TEXT,
    "entityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantMessage_threadId_createdAt_idx" ON "AssistantMessage"("threadId", "createdAt");

CREATE TABLE "ClientMemory" (
    "id" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "authorId" TEXT,
    "kind" "ClientMemoryKind" NOT NULL DEFAULT 'OTHER',
    "text" TEXT NOT NULL,
    "source" "ClientMemorySource" NOT NULL DEFAULT 'REP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ClientMemory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClientMemory_counterpartyId_archivedAt_createdAt_idx" ON "ClientMemory"("counterpartyId", "archivedAt", "createdAt" DESC);

ALTER TABLE "AssistantThread" ADD CONSTRAINT "AssistantThread_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantThread" ADD CONSTRAINT "AssistantThread_repId_fkey"
    FOREIGN KEY ("repId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "AssistantThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientMemory" ADD CONSTRAINT "ClientMemory_counterpartyId_fkey"
    FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientMemory" ADD CONSTRAINT "ClientMemory_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
