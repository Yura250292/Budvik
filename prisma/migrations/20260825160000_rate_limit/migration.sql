-- Лічильник частоти запитів для відкритого мобільного API.
--
-- Таблиця нова й порожня, індекс не потрібен: ключ і є первинним ключем,
-- а єдиний запит — точковий upsert по ньому.
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);
