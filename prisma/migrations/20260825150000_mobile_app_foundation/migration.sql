-- Основа для застосунку покупця: область дії токена, штрихкоди, пуші, обране.
--
-- Індекси звичайні, не CONCURRENTLY: CONCURRENTLY у prisma migrate падає з
-- 25001 і блокує всі наступні міграції. Таблиці PushToken і WishlistItem нові
-- й порожні; GIN по Product."barcodes" будується на колонці, яка щойно
-- зʼявилась і поки скрізь порожня, тож блокування вимірюється мілісекундами.

-- 1. Область дії токена пристрою.
--
-- Дефолт 'track' саме тут, а не в коді: усі наявні рядки — це планшети
-- торгових і водіїв, і будь-який інший дефолт мовчки відкрив би покупецьким
-- токеном контур трекінгу (або, що помітніше, закрив би планшетам зміну
-- посеред робочого дня).
ALTER TABLE "DeviceToken" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'track';

CREATE INDEX "DeviceToken_userId_scope_idx" ON "DeviceToken"("userId", "scope");

-- 2. Штрихкоди номенклатури.
--
-- Масив, бо в 1С у товару їх буває кілька — упаковка, ящик, старий код
-- постачальника, — і на коробці в руках у покупця може бути будь-який.
ALTER TABLE "Product" ADD COLUMN "barcodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- GIN, бо запит — це `"barcodes" @> ARRAY['482...']`, а B-tree по масиву
-- такому запиту не помічний узагалі.
CREATE INDEX "Product_barcodes_idx" ON "Product" USING GIN ("barcodes");

-- 3. Адреси доставки пушів.
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");

ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Обране на сервері.
CREATE TABLE "WishlistItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WishlistItem_userId_productId_key" ON "WishlistItem"("userId", "productId");
CREATE INDEX "WishlistItem_userId_idx" ON "WishlistItem"("userId");

ALTER TABLE "WishlistItem" ADD CONSTRAINT "WishlistItem_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
