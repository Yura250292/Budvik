-- CreateTable
CREATE TABLE "ClientComment" (
    "id" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientComment_counterpartyId_createdAt_idx" ON "ClientComment"("counterpartyId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClientComment" ADD CONSTRAINT "ClientComment_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientComment" ADD CONSTRAINT "ClientComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
