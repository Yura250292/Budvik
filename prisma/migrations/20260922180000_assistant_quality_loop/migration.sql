-- Петля якості помічника: оцінка → розбір → правило → регресійний тест.
--
-- Навіщо. Модель (Gemini, DeepSeek) донавчити неможливо — це чужі закриті
-- моделі. Тому «навчання» тут складається з трьох речей: керівник ставить
-- 👍/👎 і пише, як мало бути; погані відповіді збираються в чергу розбору
-- (туди ж лягають автосигнали, які хід помічає сам); підтверджене
-- виправлення стає правилом, яке підкладається в кожен наступний хід.
-- Четверта таблиця тримає регресійні кейси, щоб нове правило не зіпсувало
-- те, що вже працювало.
--
-- Одна міграція на всі три таблиці навмисно: на прод міграції котяться
-- руками, і три накати замість одного — це три шанси розійтися з кодом.
--
-- Сумісність зі старим кодом ПОВНА: міграція лише додає типи, таблиці й
-- одну колонку з умовчанням. Версія сайту, яка про них не знає, їх не
-- помічає, тож порядок «спершу міграція, потім код» тут безпечний.

-- CreateEnum
CREATE TYPE "AssistantVerdict" AS ENUM ('GOOD', 'BAD');

-- CreateEnum
CREATE TYPE "AssistantFeedbackSource" AS ENUM ('OWNER', 'AUTO');

-- CreateEnum
CREATE TYPE "AssistantReviewStatus" AS ENUM ('NEW', 'TRIAGED', 'RULED', 'TEST', 'WONTFIX');

-- CreateEnum
CREATE TYPE "AssistantLessonStatus" AS ENUM ('DRAFT', 'ACTIVE', 'OFF');

-- AlterTable
-- Які правила діяли на момент відповіді. Без цього «👎 через тиждень після
-- нового правила» нічим не доводиться.
ALTER TABLE "AssistantMessage" ADD COLUMN     "lessonIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
-- Знімок ходу лежить у самому рядку, а не збирається по messageId:
-- AssistantThread.messages видаляється каскадом, і керівник, прибравши
-- розмову, стер би разом із нею весь свій розбір.
CREATE TABLE "AssistantFeedback" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "threadId" TEXT,
    "userId" TEXT NOT NULL,
    "kind" TEXT,
    "verdict" "AssistantVerdict",
    "expected" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "toolTrace" JSONB NOT NULL,
    "model" TEXT,
    "viaModel" BOOLEAN NOT NULL,
    "intent" TEXT,
    "rounds" INTEGER NOT NULL DEFAULT 0,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "numbersChecked" INTEGER NOT NULL DEFAULT 0,
    "numbersUnverified" INTEGER NOT NULL DEFAULT 0,
    "strippedLinks" INTEGER NOT NULL DEFAULT 0,
    "lessonIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "AssistantFeedbackSource" NOT NULL DEFAULT 'OWNER',
    "signals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AssistantReviewStatus" NOT NULL DEFAULT 'NEW',
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Правило, яке підкладається в кожен наступний хід моделі.
CREATE TABLE "AssistantLesson" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "kind" TEXT,
    "triggers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "AssistantLessonStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "authorId" TEXT,
    "feedbackId" TEXT,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "AssistantLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Регресійний кейс. Очікування описують форму відповіді, а не числа:
-- набір ганяє справжній хід по живій базі, де числа міняються щодня.
CREATE TABLE "AssistantEvalCase" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ADMIN',
    "expectTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "forbidTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expectBlocks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expectVia" TEXT,
    "mustContain" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mustNotContain" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxUnverified" INTEGER,
    "rubric" TEXT,
    "golden" BOOLEAN NOT NULL DEFAULT false,
    "feedbackId" TEXT,
    "lessonId" TEXT,
    "status" "AssistantLessonStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantEvalCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Одна оцінка на відповідь: за цим ключем іде upsert, тож повторне
-- натискання переписує присуд, а автосигнал лише домальовує signals.
CREATE UNIQUE INDEX "AssistantFeedback_messageId_key" ON "AssistantFeedback"("messageId");

-- CreateIndex
-- Черга розбору «нові згори» — єдиний запит, який ходить часто.
CREATE INDEX "AssistantFeedback_status_createdAt_idx" ON "AssistantFeedback"("status", "createdAt" DESC);

-- CreateIndex
-- Окремий фільтр екрана: «покажи всі 👎».
CREATE INDEX "AssistantFeedback_verdict_createdAt_idx" ON "AssistantFeedback"("verdict", "createdAt" DESC);

-- CreateIndex
-- Відбір правил на хід: беруться лише ACTIVE свого виду.
CREATE INDEX "AssistantLesson_status_kind_idx" ON "AssistantLesson"("status", "kind");

-- CreateIndex
CREATE INDEX "AssistantEvalCase_status_idx" ON "AssistantEvalCase"("status");

-- AddForeignKey
-- SetNull, а не Cascade: розбір мусить пережити видалення розмови.
ALTER TABLE "AssistantFeedback" ADD CONSTRAINT "AssistantFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantFeedback" ADD CONSTRAINT "AssistantFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantLesson" ADD CONSTRAINT "AssistantLesson_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
