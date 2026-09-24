-- CreateTable
CREATE TABLE "CostItem" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "groupName" TEXT,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "repId" TEXT,
    "storeName" TEXT,
    "manualAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseEntry" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "docExternalId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docDate" TIMESTAMP(3) NOT NULL,
    "costItemId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "department" TEXT,
    "personName" TEXT,
    "comment" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CostItem_externalId_key" ON "CostItem"("externalId");

-- CreateIndex
CREATE INDEX "CostItem_scope_kind_idx" ON "CostItem"("scope", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseEntry_externalId_key" ON "ExpenseEntry"("externalId");

-- CreateIndex
CREATE INDEX "ExpenseEntry_docDate_idx" ON "ExpenseEntry"("docDate");

-- CreateIndex
CREATE INDEX "ExpenseEntry_costItemId_docDate_idx" ON "ExpenseEntry"("costItemId", "docDate");

-- AddForeignKey
ALTER TABLE "ExpenseEntry" ADD CONSTRAINT "ExpenseEntry_costItemId_fkey" FOREIGN KEY ("costItemId") REFERENCES "CostItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Читальна роль MCP-конектора (scripts/mcp/readonly-role.sql) нових таблиць
-- сама не бачить: GRANT ON ALL TABLES діє лише на наявні. Перезапуск скрипта
-- ролі поміняв би їй пароль, тож даємо права тут — і лише там, де роль є.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'budvik_mcp_ro') THEN
    GRANT SELECT ON "CostItem", "ExpenseEntry" TO budvik_mcp_ro;
  END IF;
END $$;
