-- CreateEnum
CREATE TYPE "McpTokenKind" AS ENUM ('ACCESS', 'REFRESH');

-- CreateTable
CREATE TABLE "McpClient" (
    "id" TEXT NOT NULL,
    "secret" TEXT,
    "name" TEXT,
    "redirectUris" TEXT[],
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "McpClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpAuthCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "scopes" TEXT[],
    "resource" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "familyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpAuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpToken" (
    "id" TEXT NOT NULL,
    "kind" "McpTokenKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT[],
    "resource" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpCall" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "rows" INTEGER,
    "ms" INTEGER NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpAuthCode_codeHash_key" ON "McpAuthCode"("codeHash");

-- CreateIndex
CREATE INDEX "McpAuthCode_familyId_idx" ON "McpAuthCode"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "McpToken_tokenHash_key" ON "McpToken"("tokenHash");

-- CreateIndex
CREATE INDEX "McpToken_familyId_idx" ON "McpToken"("familyId");

-- CreateIndex
CREATE INDEX "McpToken_userId_kind_idx" ON "McpToken"("userId", "kind");

-- CreateIndex
CREATE INDEX "McpCall_createdAt_idx" ON "McpCall"("createdAt");

-- CreateIndex
CREATE INDEX "McpCall_userId_createdAt_idx" ON "McpCall"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "McpAuthCode" ADD CONSTRAINT "McpAuthCode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "McpClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpAuthCode" ADD CONSTRAINT "McpAuthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpToken" ADD CONSTRAINT "McpToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "McpClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpToken" ADD CONSTRAINT "McpToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

