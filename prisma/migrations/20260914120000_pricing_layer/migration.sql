-- Ціновий шар вітрини (docs/pricing.md).
--
-- Досі обмін писав ціну вітрини прямо в Product.price з типу цін «6.МАГАЗИНИ».
-- Тепер ціни 1С лежать окремо (Price1C), ціни сайтів виробників — окремо
-- (MarketPrice), правила — в PricePolicy, а ціну вітрини рахує рушій і пише в
-- SitePrice та копією в Product.price. Лише додає таблиці: код, що вже
-- працює на Vercel і Railway, їх не бачить і не ламається. У 1С нічого не пишеться.
--
-- Писано руками, а не `migrate diff`: diff проти бази тягнув би чужий дрейф
-- (trigram-індекс пошуку Product_name_trgm_idx і два зовнішні ключі), якого
-- ця міграція торкатися не повинна.

CREATE TYPE "PriceKind1C" AS ENUM ('RETAIL', 'WHOLESALE');

CREATE TYPE "SitePriceBasis" AS ENUM ('MARKUP', 'MARKET', 'FLOOR', 'RETAIL_1C', 'NONE');

CREATE TABLE "Price1C" (
    "productId" TEXT NOT NULL,
    "kind" "PriceKind1C" NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Price1C_pkey" PRIMARY KEY ("productId","kind")
);

CREATE TABLE "MarketPrice" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "inStock" BOOLEAN,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MarketPrice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PricePolicy" (
    "id" TEXT NOT NULL,
    "brandId" TEXT,
    "markup" DOUBLE PRECISION NOT NULL,
    "minMarkup" DOUBLE PRECISION NOT NULL,
    "followMarket" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricePolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SitePrice" (
    "productId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "basis" "SitePriceBasis" NOT NULL,
    "wholesale" DOUBLE PRECISION,
    "retail1C" DOUBLE PRECISION,
    "market" DOUBLE PRECISION,
    "marketSource" TEXT,
    "markup" DOUBLE PRECISION,
    "minMarkup" DOUBLE PRECISION,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SitePrice_pkey" PRIMARY KEY ("productId")
);

CREATE INDEX "MarketPrice_checkedAt_idx" ON "MarketPrice"("checkedAt");
CREATE UNIQUE INDEX "MarketPrice_productId_source_key" ON "MarketPrice"("productId", "source");
CREATE UNIQUE INDEX "PricePolicy_brandId_key" ON "PricePolicy"("brandId");
CREATE INDEX "SitePrice_basis_idx" ON "SitePrice"("basis");

ALTER TABLE "Price1C" ADD CONSTRAINT "Price1C_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketPrice" ADD CONSTRAINT "MarketPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PricePolicy" ADD CONSTRAINT "PricePolicy_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SitePrice" ADD CONSTRAINT "SitePrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Загальне правило власника: +30 %, підлога +25 %, звіряти з ринком.
INSERT INTO "PricePolicy" ("id", "brandId", "markup", "minMarkup", "followMarket", "updatedAt")
VALUES ('default', NULL, 1.3, 1.25, true, CURRENT_TIMESTAMP);
