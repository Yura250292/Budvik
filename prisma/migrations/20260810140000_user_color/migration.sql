-- AlterTable
-- IF NOT EXISTS: цю колонку могли додати вручну, поки міграцію не накотили —
-- тоді повторний прогін не має валити деплой.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "color" TEXT;
