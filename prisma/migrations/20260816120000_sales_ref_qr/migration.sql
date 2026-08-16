-- QR-каталог торгового: клієнт, що прийшов за QR, закріплюється за тим,
-- хто цей QR показав, і його замовлення йдуть у оборот цього торгового.
--
-- Чому не SalesRepClient: та таблиця звʼязує торгового з Counterparty —
-- контрагентом з 1С. Роздрібний покупець сайту (User/Order) там не існує
-- взагалі, тож прив'язка живе полем на самому User.

-- Код у QR-лінку (/r/[code]). Nullable і генерується ліниво при першому
-- відкритті QR — тим, хто QR не користується, код ні до чого.
ALTER TABLE "User" ADD COLUMN "refCode" TEXT;
CREATE UNIQUE INDEX "User_refCode_key" ON "User"("refCode");

-- Торговий, чий QR привів клієнта. Ставиться один раз (перший виграє):
-- перезапис означав би, що чужим QR можна відібрати клієнта.
ALTER TABLE "User" ADD COLUMN "referredBySalesRepId" TEXT;
CREATE INDEX "User_referredBySalesRepId_idx" ON "User"("referredBySalesRepId");
ALTER TABLE "User" ADD CONSTRAINT "User_referredBySalesRepId_fkey"
  FOREIGN KEY ("referredBySalesRepId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Знімок торгового на момент замовлення, а не join через User при читанні:
-- якщо клієнта колись перепривʼяжуть, минулий оборот лишиться за тим,
-- хто його справді зробив.
ALTER TABLE "Order" ADD COLUMN "salesRepId" TEXT;
CREATE INDEX "Order_salesRepId_idx" ON "Order"("salesRepId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_salesRepId_fkey"
  FOREIGN KEY ("salesRepId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
