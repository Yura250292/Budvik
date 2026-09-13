-- Історія цін для пуша «подорожчало те, що беруть ваші клієнти».
--
-- Обмін переписує Product.price на місці, тож «яка ціна була вчора» досі
-- не знав ніхто. ProductPriceSeen — остання бачена ціна (база порівняння),
-- ProductPriceChange — журнал різниць. Обидві пише воркер одним запитом;
-- перший прохід лише наповнює базу, змін не пише. У 1С нічого не пишеться.
CREATE TABLE "ProductPriceSeen" (
    "productId" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "wholesalePrice" DOUBLE PRECISION,
    "seenAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductPriceSeen_pkey" PRIMARY KEY ("productId")
);

CREATE TABLE "ProductPriceChange" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "oldPrice" DOUBLE PRECISION NOT NULL,
    "newPrice" DOUBLE PRECISION NOT NULL,
    "oldWholesale" DOUBLE PRECISION,
    "newWholesale" DOUBLE PRECISION,
    "changedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductPriceChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductPriceChange_changedAt_idx" ON "ProductPriceChange"("changedAt");
CREATE INDEX "ProductPriceChange_productId_changedAt_idx" ON "ProductPriceChange"("productId", "changedAt");
