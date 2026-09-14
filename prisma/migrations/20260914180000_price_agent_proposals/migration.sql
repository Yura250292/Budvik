-- Агент цін і затвердження адміном (docs/pricing.md).
--
-- Правило власника, редакція 14.09.2026: роздріб завжди строго дорожчий за
-- опт; базова ціна — опт + націнка; конкурентну ціну раз на тиждень пропонує
-- агент, а на вітрину її ставить лише адмін. Ринок сам ціну більше не рухає.
--
-- Лише додає: код, що вже працює на Vercel і Railway, нових таблиць не бачить.
-- followMarket вимикається, щоб стара версія рушія до передеплою воркера теж
-- не опускала ціни до ринку без затвердження. У 1С нічого не пишеться.
--
-- Писано руками, а не `migrate diff`: diff проти бази тягнув би чужий дрейф
-- (Product_name_trgm_idx і два зовнішні ключі).

ALTER TYPE "SitePriceBasis" ADD VALUE IF NOT EXISTS 'APPROVED' AFTER 'MARKUP';

CREATE TYPE "PriceProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

ALTER TABLE "PricePolicy" ADD COLUMN "undercut" DOUBLE PRECISION NOT NULL DEFAULT 0.01;
-- Підлога — строго вище опту, а не +25 %.
UPDATE "PricePolicy" SET "minMarkup" = 1.01 WHERE "id" = 'default';
UPDATE "PricePolicy" SET "followMarket" = false;

ALTER TABLE "MarketPrice" ADD COLUMN "title" TEXT, ADD COLUMN "lastStatus" TEXT, ADD COLUMN "foundBy" TEXT;
UPDATE "MarketPrice" SET "lastStatus" = 'ok', "foundBy" = 'vendor_crawl';

CREATE TABLE "PriceProposal" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "PriceProposalStatus" NOT NULL DEFAULT 'PENDING',
    "currentPrice" DOUBLE PRECISION NOT NULL,
    "proposedPrice" DOUBLE PRECISION NOT NULL,
    "wholesale" DOUBLE PRECISION NOT NULL,
    "market" DOUBLE PRECISION NOT NULL,
    "marketSource" TEXT NOT NULL,
    "marketUrl" TEXT NOT NULL,
    "undercut" DOUBLE PRECISION NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence" JSONB NOT NULL,
    "week" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "PriceProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ApprovedPrice" (
    "productId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "proposalId" TEXT,
    "market" DOUBLE PRECISION,
    "marketSource" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovedPrice_pkey" PRIMARY KEY ("productId")
);

CREATE TABLE "MarketLookup" (
    "productId" TEXT NOT NULL,
    "lookedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "pagesFound" INTEGER NOT NULL DEFAULT 0,
    "pagesAccepted" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "MarketLookup_pkey" PRIMARY KEY ("productId")
);

CREATE INDEX "PriceProposal_status_createdAt_idx" ON "PriceProposal"("status", "createdAt");
CREATE INDEX "PriceProposal_productId_status_idx" ON "PriceProposal"("productId", "status");
CREATE INDEX "MarketLookup_lookedAt_idx" ON "MarketLookup"("lookedAt");

ALTER TABLE "PriceProposal" ADD CONSTRAINT "PriceProposal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ApprovedPrice" ADD CONSTRAINT "ApprovedPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketLookup" ADD CONSTRAINT "MarketLookup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
