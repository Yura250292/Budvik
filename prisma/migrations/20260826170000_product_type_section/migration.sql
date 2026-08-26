-- Група товару і розділ каталогу: результат класифікатора
-- (src/lib/catalog/classify.ts) у колонках, бо каталог фільтрує в SQL.
ALTER TABLE "Product" ADD COLUMN "typeKey" TEXT;
ALTER TABLE "Product" ADD COLUMN "sectionId" TEXT;

-- Звичайний CREATE INDEX, не CONCURRENTLY: у Prisma-міграції той падає з
-- 25001 (транзакція) і блокує всі наступні міграції.
CREATE INDEX "Product_sectionId_typeKey_idx" ON "Product"("sectionId", "typeKey");
CREATE INDEX "Product_typeKey_idx" ON "Product"("typeKey");
