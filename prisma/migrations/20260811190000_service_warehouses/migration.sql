-- Сервісні склади: брак, уцінка, майстерня, ремонти.
--
-- Товар на них фізично є, але продавати його не можна. Доти Product.stock
-- підсумовував УСІ склади, тому 43 позиції зі «Складу Браку» та «Майстерні
-- Липинського» висіли у вітрині як звичайний товар (~32 тис. грн у прайсі).
ALTER TABLE "StockLocation" ADD COLUMN "isService" BOOLEAN NOT NULL DEFAULT false;

-- Ознаки складу 1С не передає, тому визначаємо за назвою — тим самим набором
-- підрядків, що й у isServiceWarehouse() в src/lib/sync-ingest/apply-stock.ts.
UPDATE "StockLocation"
SET "isService" = true
WHERE upper("name") LIKE '%РЕМОНТ%'
   OR upper("name") LIKE '%БРАК%'
   OR upper("name") LIKE '%ПЕРЕОЦ%'
   OR upper("name") LIKE '%УЦІНК%'
   OR upper("name") LIKE '%ЗЛАМАН%'
   OR upper("name") LIKE '%МАЙСТЕРН%'
   OR upper("name") LIKE '%СЕРВІС%'
   OR upper("name") LIKE '%СЕРВИС%'
   OR upper("name") LIKE '%НЕКОНДИЦ%';

-- Перерахунок вільного залишку без сервісних складів. Товар, який лежав лише
-- на них, отримує нуль і йде у вітрині в кінець списку як «немає в наявності».
UPDATE "Product" p
SET "stock" = COALESCE((
      SELECT SUM(ls."available")
      FROM "LocationStock" ls
      JOIN "StockLocation" sl ON sl."id" = ls."stockLocationId"
      WHERE ls."productId" = p."id" AND sl."isService" = false
    ), 0)
WHERE EXISTS (
  SELECT 1
  FROM "LocationStock" ls2
  JOIN "StockLocation" sl2 ON sl2."id" = ls2."stockLocationId"
  WHERE ls2."productId" = p."id" AND sl2."isService" = true
);
