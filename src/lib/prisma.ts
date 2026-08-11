import { PrismaClient } from "@prisma/client";

/**
 * Один PrismaClient на інстанс лямбди — і в dev, і в проді.
 *
 * Раніше синглтон кешувався лише поза продакшеном (шаблон із доків Prisma,
 * де умова рятує від витоку при hot-reload). На Vercel це працює навпаки:
 * кожен холодний старт створював новий клієнт зі своїм пулом, старі не
 * закривалися, і Postgres віддавав «FATAL: sorry, too many clients already».
 *
 * connection_limit=1 — бо конкурентність тут дає сама платформа: лямбда
 * обробляє один запит за раз, тож пул на кілька з'єднань всередині неї
 * просто марно тримає слоти на сервері. Railway не має вбудованого пулера,
 * тому ліміт стримуємо на боці клієнта.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) return new PrismaClient();

  // Не чіпаємо рядок, якщо ліміт уже заданий руками через env.
  const withLimit = new URL(url);
  if (!withLimit.searchParams.has("connection_limit")) {
    withLimit.searchParams.set("connection_limit", "1");
  }
  if (!withLimit.searchParams.has("pool_timeout")) {
    withLimit.searchParams.set("pool_timeout", "15");
  }

  return new PrismaClient({ datasources: { db: { url: withLimit.toString() } } });
}

export const prisma = globalForPrisma.prisma ?? createClient();

globalForPrisma.prisma = prisma;
