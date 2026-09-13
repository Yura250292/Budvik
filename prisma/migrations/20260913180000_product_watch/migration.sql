-- Запит торгового «повідомити, коли приїде» на відсутній товар.
--
-- «Коли буде піна?» торговий зараз питає дзвінком на склад і тримає
-- відповідь у голові. Тут він тисне дзвіночок у каталозі, а воркер, щойно
-- вільний залишок стане більшим за нуль, пише подію в стрічку й шле пуш.
-- Пише лише в базу сайту; 1С не зачіпається.
CREATE TABLE "ProductWatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductWatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductWatch_userId_productId_key" ON "ProductWatch"("userId", "productId");
CREATE INDEX "ProductWatch_productId_idx" ON "ProductWatch"("productId");

ALTER TABLE "ProductWatch" ADD CONSTRAINT "ProductWatch_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductWatch" ADD CONSTRAINT "ProductWatch_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
