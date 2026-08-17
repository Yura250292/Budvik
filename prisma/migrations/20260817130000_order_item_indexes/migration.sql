-- Індекси позицій замовлення: groupBy по productId (бестселери головної)
-- і join позицій до замовлення досі йшли повним сканом. Таблиця мала,
-- тож звичайний CREATE INDEX без CONCURRENTLY безпечний (блокування на
-- частки секунди) і не ламає прогін міграцій, на відміну від CONCURRENTLY.
CREATE INDEX IF NOT EXISTS "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "OrderItem_productId_idx" ON "OrderItem"("productId");
