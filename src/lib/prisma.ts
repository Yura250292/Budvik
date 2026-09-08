import { PrismaClient } from "@prisma/client";

/**
 * Один PrismaClient на інстанс лямбди — і в dev, і в проді.
 *
 * Раніше синглтон кешувався лише поза продакшеном (шаблон із доків Prisma,
 * де умова рятує від витоку при hot-reload). На Vercel це працює навпаки:
 * кожен холодний старт створював новий клієнт зі своїм пулом, старі не
 * закривалися, і Postgres віддавав «FATAL: sorry, too many clients already».
 *
 * connection_limit. Раніше тут стояла 1 з поясненням «лямбда обробляє
 * один запит за раз». Лямбда справді бере один HTTP-запит за раз, але
 * ВСЕРЕДИНІ запиту маршрути шлють по 5-9 запитів через Promise.all — і пул
 * на одне з'єднання серіалізував їх усі, кожен з повним RTT до бази.
 * Заміряно: 8 паралельних запитів — 987 мс при ліміті 1 проти 647 мс при 10.
 *
 * Чому саме 3, а не більше: слоти не безкоштовні. Кожен відкритий бекенд
 * Postgres — це власний процес зі своїм кешем; на Railway памʼять бази і є
 * головна стаття рахунку. Заміряно 08.09.2026: 59 сплячих зʼєднань від
 * теплих лямбд Vercel при 0,9 ГБ памʼяті сервісу. Три замість пʼяти
 * лишають запас на паралельні запити всередині маршруту (Promise.all із
 * 5-9 запитів серіалізується щонайбільше в три хвилі, а не в дев'ять, як
 * було б при ліміті 1) і знімають третину слотів.
 *
 * Піднімати назад варто лише разом із PgBouncer перед базою — тоді ліміт
 * тримає пулер, а не кожна лямбда окремо.
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
    withLimit.searchParams.set("connection_limit", "3");
  }
  if (!withLimit.searchParams.has("pool_timeout")) {
    withLimit.searchParams.set("pool_timeout", "15");
  }

  return new PrismaClient({ datasources: { db: { url: withLimit.toString() } } });
}

export const prisma = globalForPrisma.prisma ?? createClient();

globalForPrisma.prisma = prisma;
