-- AlterTable
-- IF NOT EXISTS: тримаємо той самий стиль, що й user_color — повторний прогін
-- на базі, де колонку вже додали, не має валити деплой.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;
