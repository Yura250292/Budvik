-- Здача каси водієм: «зібрав за день N ₴ — везу в офіс».
--
-- Visit каже, скільки водій забрав у клієнта, але не каже, чи гроші доїхали.
-- Без окремого запису «на руках» рахувалося б вічно: зібрав 4 320 — і назавжди
-- винен, скільки б разів не здавав.
--
-- Індекси звичайні, не CONCURRENTLY: CONCURRENTLY у prisma migrate падає з
-- 25001 і блокує всі наступні міграції. Таблиця нова й порожня, блокувати
-- нічого.
CREATE TABLE "CashHandover" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "expectedAmount" DOUBLE PRECISION,
    "comment" TEXT,
    "handedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "confirmedAmount" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashHandover_pkey" PRIMARY KEY ("id")
);

-- Без UNIQUE по (driverId, day) навмисно: здають і в обід, і ввечері.
CREATE INDEX "CashHandover_driverId_day_idx" ON "CashHandover"("driverId", "day");
CREATE INDEX "CashHandover_day_idx" ON "CashHandover"("day");

-- Робочий список касира — «що ще не підтверджено».
CREATE INDEX "CashHandover_confirmedAt_idx" ON "CashHandover"("confirmedAt");

ALTER TABLE "CashHandover" ADD CONSTRAINT "CashHandover_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull: звільнений касир не має забирати з собою історію здач.
ALTER TABLE "CashHandover" ADD CONSTRAINT "CashHandover_confirmedById_fkey"
    FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
