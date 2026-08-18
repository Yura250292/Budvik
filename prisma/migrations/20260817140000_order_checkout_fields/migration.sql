-- Роздрібне замовлення отримує все, чого бракувало для реального оформлення:
-- контакти, адресу, спосіб доставки й оплати, людяний номер і гостьовий доступ.
--
-- Усе адитивне, крім DROP NOT NULL на userId — воно потрібне для гостьових
-- замовлень. Наявні рядки лишаються з userId, тож нічого не переписується.
-- "Order" мала, CONCURRENTLY не потрібен.

CREATE TYPE "RetailDelivery" AS ENUM ('DELIVERY', 'PICKUP');
CREATE TYPE "PaymentMethod" AS ENUM ('COD');

-- SERIAL сам проставить номери наявним замовленням у порядку фізичних рядків
-- і виставить лічильник далі — окремий backfill не потрібен.
ALTER TABLE "Order" ADD COLUMN "orderNumber" SERIAL NOT NULL;

ALTER TABLE "Order" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "Order" ADD COLUMN "contactName" TEXT;
ALTER TABLE "Order" ADD COLUMN "phone" TEXT;
ALTER TABLE "Order" ADD COLUMN "city" TEXT;
ALTER TABLE "Order" ADD COLUMN "address" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryMethod" "RetailDelivery" NOT NULL DEFAULT 'DELIVERY';
ALTER TABLE "Order" ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'COD';
ALTER TABLE "Order" ADD COLUMN "comment" TEXT;
ALTER TABLE "Order" ADD COLUMN "guestToken" TEXT;

CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");
CREATE UNIQUE INDEX "Order_guestToken_key" ON "Order"("guestToken");
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
