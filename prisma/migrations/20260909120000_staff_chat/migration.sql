-- Чат персоналу: групи за ролями, особисті повідомлення, переслані відповіді
-- помічника, фото.
--
-- Розмови окремою таблицею не заводимо: адреса лежить у самому повідомленні
-- (toAll / toRoles / toUserId), а ключ розмови з неї виводиться. Так одне
-- повідомлення офісу «торговим і водіям» живе в обох групових розмовах без
-- дублювання рядків. «Прочитано» — властивість пари людина+розмова, тому
-- StaffChatRead зберігає лише мітку часу, а не рядок на кожне повідомлення.
CREATE TYPE "StaffMessageKind" AS ENUM ('TEXT', 'ASSISTANT');

CREATE TABLE "StaffMessage" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "StaffMessageKind" NOT NULL DEFAULT 'TEXT',
    "text" TEXT NOT NULL DEFAULT '',
    "quote" TEXT,
    "toAll" BOOLEAN NOT NULL DEFAULT false,
    "toRoles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "toUserId" TEXT,
    "sourceAssistantMessageId" TEXT,
    "sourceSection" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffMessage_createdAt_idx" ON "StaffMessage"("createdAt");
CREATE INDEX "StaffMessage_toUserId_createdAt_idx" ON "StaffMessage"("toUserId", "createdAt");
CREATE INDEX "StaffMessage_authorId_createdAt_idx" ON "StaffMessage"("authorId", "createdAt");

ALTER TABLE "StaffMessage" ADD CONSTRAINT "StaffMessage_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffMessage" ADD CONSTRAINT "StaffMessage_toUserId_fkey"
  FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Відповідь помічника можуть стерти разом із розмовою; переслане лишається,
-- лише втрачає посилання на джерело.
ALTER TABLE "StaffMessage" ADD CONSTRAINT "StaffMessage_sourceAssistantMessageId_fkey"
  FOREIGN KEY ("sourceAssistantMessageId") REFERENCES "AssistantMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "StaffMessagePhoto" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffMessagePhoto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffMessagePhoto_messageId_position_idx" ON "StaffMessagePhoto"("messageId", "position");

ALTER TABLE "StaffMessagePhoto" ADD CONSTRAINT "StaffMessagePhoto_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "StaffMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StaffChatRead" (
    "userId" TEXT NOT NULL,
    "conversation" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffChatRead_pkey" PRIMARY KEY ("userId", "conversation")
);

ALTER TABLE "StaffChatRead" ADD CONSTRAINT "StaffChatRead_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
